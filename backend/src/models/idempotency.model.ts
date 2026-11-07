import mongoose, { Document, Schema } from "mongoose";

export const IdempotencyOperation = {
  CREATE_TASK: "CREATE_TASK",
  CREATE_PROJECT: "CREATE_PROJECT",
} as const;

export type IdempotencyOperationType =
  (typeof IdempotencyOperation)[keyof typeof IdempotencyOperation];

export const IdempotencyStatus = {
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
} as const;

export type IdempotencyStatusType =
  (typeof IdempotencyStatus)[keyof typeof IdempotencyStatus];

export interface IdempotencyDocument extends Document {
  userId: mongoose.Types.ObjectId;
  key: string;
  operation: IdempotencyOperationType;
  workspaceId: mongoose.Types.ObjectId;
  requestHash: string;
  status: IdempotencyStatusType;
  responseStatus?: number | null;
  responseBody?: any;
  createdAt: Date;
  expiresAt: Date;
}

const idempotencySchema = new Schema<IdempotencyDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    key: {
      type: String,
      required: true,
      trim: true,
    },
    operation: {
      type: String,
      enum: Object.values(IdempotencyOperation),
      required: true,
    },
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    requestHash: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(IdempotencyStatus),
      default: IdempotencyStatus.PROCESSING,
      required: true,
    },
    responseStatus: {
      type: Number,
      default: null,
    },
    responseBody: {
      type: Schema.Types.Mixed,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound Unique Index: prevents duplicate execution of the same key per user, operation, and workspace
idempotencySchema.index(
  { userId: 1, key: 1, operation: 1, workspaceId: 1 },
  { unique: true }
);

// TTL Index for automatic background cleanup after expiresAt
idempotencySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const IdempotencyModel = mongoose.model<IdempotencyDocument>(
  "Idempotency",
  idempotencySchema
);

export default IdempotencyModel;
