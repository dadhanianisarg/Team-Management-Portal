import crypto from "crypto";
import mongoose from "mongoose";
import IdempotencyModel, {
  IdempotencyOperationType,
  IdempotencyStatus,
} from "../models/idempotency.model";
import { BadRequestException, ConflictException } from "../utils/appError";
import { ErrorCodeEnum } from "../enums/error-code.enum";
import { config } from "../config/app.config";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const validateIdempotencyKey = (key: unknown): string => {
  if (!key || typeof key !== "string" || key.trim() === "") {
    throw new BadRequestException(
      "Idempotency-Key header is required",
      ErrorCodeEnum.IDEMPOTENCY_KEY_REQUIRED
    );
  }
  const trimmed = key.trim();
  if (!UUID_REGEX.test(trimmed)) {
    throw new BadRequestException(
      "Invalid Idempotency-Key header format. Must be a valid UUID.",
      ErrorCodeEnum.IDEMPOTENCY_KEY_INVALID
    );
  }
  return trimmed;
};

export const canonicalize = (obj: any): any => {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(canonicalize);
  }
  const sortedKeys = Object.keys(obj).sort();
  const result: Record<string, any> = {};
  for (const key of sortedKeys) {
    if (obj[key] !== undefined) {
      result[key] = canonicalize(obj[key]);
    }
  }
  return result;
};

export const computeRequestHash = (payload: any): string => {
  const canonicalJson = JSON.stringify(canonicalize(payload));
  return crypto.createHash("sha256").update(canonicalJson).digest("hex");
};

export interface IdempotencyResult<T = any> {
  status: number;
  body: T;
  isIdempotentReplay: boolean;
}

export const executeIdempotentTransaction = async <T>(
  params: {
    userId: string;
    workspaceId: string;
    key: string;
    operation: IdempotencyOperationType;
    payloadToHash: Record<string, any>;
  },
  operationFn: (session: mongoose.ClientSession) => Promise<{ status: number; body: T }>
): Promise<IdempotencyResult<T>> => {
  const { userId, workspaceId, key, operation, payloadToHash } = params;

  const validKey = validateIdempotencyKey(key);
  const requestHash = computeRequestHash(payloadToHash);

  // 1. Check existing record outside transaction for quick replay
  const existingRecord = await IdempotencyModel.findOne({
    userId,
    key: validKey,
    operation,
    workspaceId,
  });

  if (existingRecord) {
    if (existingRecord.requestHash !== requestHash) {
      throw new ConflictException(
        "Idempotency key was already used with a different request payload",
        ErrorCodeEnum.IDEMPOTENCY_KEY_REUSED
      );
    }
    if (existingRecord.status === IdempotencyStatus.COMPLETED) {
      return {
        status: existingRecord.responseStatus || 200,
        body: existingRecord.responseBody,
        isIdempotentReplay: true,
      };
    }
    if (existingRecord.status === IdempotencyStatus.PROCESSING) {
      // Check if stale (older than 60s)
      const isStale = Date.now() - existingRecord.createdAt.getTime() > 60000;
      if (!isStale) {
        throw new ConflictException(
          "A request with this idempotency key is currently processing. Please retry shortly.",
          ErrorCodeEnum.IDEMPOTENCY_REQUEST_IN_PROGRESS
        );
      }
    }
  }

  // 2. Start Mongoose transaction
  const session = await mongoose.startSession();
  const retentionHours = config.IDEMPOTENCY_RETENTION_HOURS || 24;
  const expiresAt = new Date(Date.now() + retentionHours * 3600 * 1000);

  try {
    session.startTransaction();

    // Step 8: Insert an IdempotencyRecord with status PROCESSING
    const record = new IdempotencyModel({
      userId,
      key: validKey,
      operation,
      workspaceId,
      requestHash,
      status: IdempotencyStatus.PROCESSING,
      expiresAt,
    });
    await record.save({ session });

    // Step 9: Create resource inside the transaction
    const result = await operationFn(session);

    // Step 10 & 11: Set to COMPLETED with response data
    record.status = IdempotencyStatus.COMPLETED;
    record.responseStatus = result.status;
    record.responseBody = result.body;
    await record.save({ session });

    // Step 12: Commit transaction
    await session.commitTransaction();

    return {
      status: result.status,
      body: result.body,
      isIdempotentReplay: false,
    };
  } catch (error: any) {
    await session.abortTransaction();

    // Check for duplicate key error (code 11000) or Transient write conflict in concurrent requests
    const isDuplicateKey =
      error?.code === 11000 || error?.writeErrors?.[0]?.code === 11000;
    const isTransientConflict =
      error?.hasErrorLabel?.("TransientTransactionError") ||
      error?.message?.includes("WriteConflict");

    if (isDuplicateKey || isTransientConflict) {
      return await waitForWinningTransaction<T>({
        userId,
        workspaceId,
        key: validKey,
        operation,
        requestHash,
        payloadToHash,
        operationFn,
      });
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

async function waitForWinningTransaction<T>(params: {
  userId: string;
  workspaceId: string;
  key: string;
  operation: IdempotencyOperationType;
  requestHash: string;
  payloadToHash: Record<string, any>;
  operationFn: (session: mongoose.ClientSession) => Promise<{ status: number; body: T }>;
}): Promise<IdempotencyResult<T>> {
  const maxAttempts = 15;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 200));

    const winnerRecord = await IdempotencyModel.findOne({
      userId: params.userId,
      key: params.key,
      operation: params.operation,
      workspaceId: params.workspaceId,
    });

    if (winnerRecord) {
      if (winnerRecord.requestHash !== params.requestHash) {
        throw new ConflictException(
          "Idempotency key was already used with a different request payload",
          ErrorCodeEnum.IDEMPOTENCY_KEY_REUSED
        );
      }
      if (winnerRecord.status === IdempotencyStatus.COMPLETED) {
        return {
          status: winnerRecord.responseStatus || 200,
          body: winnerRecord.responseBody,
          isIdempotentReplay: true,
        };
      }
      // Still PROCESSING in winner, continue polling
    } else {
      // Winner transaction aborted! Key is released. Retry execution cleanly.
      return await executeIdempotentTransaction(
        {
          userId: params.userId,
          workspaceId: params.workspaceId,
          key: params.key,
          operation: params.operation,
          payloadToHash: params.payloadToHash,
        },
        params.operationFn
      );
    }
  }

  throw new ConflictException(
    "A request with this idempotency key is currently processing. Please retry shortly.",
    ErrorCodeEnum.IDEMPOTENCY_REQUEST_IN_PROGRESS
  );
}
