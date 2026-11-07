import "dotenv/config";
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import mongoose from "mongoose";
import { config } from "../config/app.config";
import TaskModel from "../models/task.model";
import ProjectModel from "../models/project.model";
import WorkspaceModel from "../models/workspace.model";
import UserModel from "../models/user.model";
import IdempotencyModel, {
  IdempotencyOperation,
  IdempotencyStatus,
} from "../models/idempotency.model";
import { createTaskService } from "../services/task.service";
import { createProjectService } from "../services/project.service";
import { validateIdempotencyKey } from "../services/idempotency.service";
import { BadRequestException, ConflictException } from "../utils/appError";
import { ErrorCodeEnum } from "../enums/error-code.enum";

describe("End-to-End Idempotency System Test Suite", () => {
  let testWorkspaceId: string;
  let otherWorkspaceId: string;
  let testProjectId: string;
  let otherProjectId: string;
  let userAId: string;
  let userBId: string;

  before(async () => {
    await mongoose.connect(config.MONGO_URI);

    // Create test users
    const userA: any = await UserModel.create({
      name: "Idempotent User A",
      email: `idempotent_a_${Date.now()}@example.com`,
      password: "password123",
    });
    userAId = userA._id.toString();

    const userB: any = await UserModel.create({
      name: "Idempotent User B",
      email: `idempotent_b_${Date.now()}@example.com`,
      password: "password123",
    });
    userBId = userB._id.toString();

    // Create test workspaces
    const workspaceA: any = await WorkspaceModel.create({
      name: `Idempotency Test Workspace ${Date.now()}`,
      owner: userA._id,
      inviteCode: `INV-IDEM-${Date.now()}-A`,
    });
    testWorkspaceId = workspaceA._id.toString();

    const workspaceB: any = await WorkspaceModel.create({
      name: `Other Workspace ${Date.now()}`,
      owner: userB._id,
      inviteCode: `INV-IDEM-${Date.now()}-B`,
    });
    otherWorkspaceId = workspaceB._id.toString();

    // Create test projects
    const projectA: any = await ProjectModel.create({
      name: "Idempotent Project A",
      workspace: workspaceA._id,
      createdBy: userA._id,
    });
    testProjectId = projectA._id.toString();

    const projectB: any = await ProjectModel.create({
      name: "Other Project B",
      workspace: workspaceB._id,
      createdBy: userB._id,
    });
    otherProjectId = projectB._id.toString();
  });

  after(async () => {
    // Clean up test documents
    await TaskModel.deleteMany({ workspace: { $in: [testWorkspaceId, otherWorkspaceId] } });
    await ProjectModel.deleteMany({ _id: { $in: [testProjectId, otherProjectId] } });
    await WorkspaceModel.deleteMany({ _id: { $in: [testWorkspaceId, otherWorkspaceId] } });
    await UserModel.deleteMany({ _id: { $in: [userAId, userBId] } });
    await IdempotencyModel.deleteMany({
      workspaceId: { $in: [testWorkspaceId, otherWorkspaceId] },
    });
    await mongoose.disconnect();
  });

  // --- Task Creation Idempotency ---

  test("1 & 2 & 3 & 4. New task creation and repeated execution with same key returns identical task and creates only 1 document", async () => {
    const key = crypto.randomUUID();
    const payload = {
      title: "Write End-to-End Tests",
      description: "Comprehensive test suite for idempotency",
      priority: "HIGH",
      status: "TODO",
    };

    // 1. Initial request
    const firstResult = await createTaskService(
      testWorkspaceId,
      testProjectId,
      userAId,
      payload,
      key
    );

    assert.ok(firstResult.task);
    assert.equal(firstResult.isIdempotentReplay, false);
    const firstTaskId = (firstResult.task as any)._id.toString();

    // 2. Duplicate retry request with same key and payload
    const secondResult = await createTaskService(
      testWorkspaceId,
      testProjectId,
      userAId,
      payload,
      key
    );

    // 3. Both responses contain the exact same task ID
    assert.ok(secondResult.task);
    assert.equal(secondResult.isIdempotentReplay, true);
    const secondTaskId = (secondResult.task as any)._id.toString();
    assert.equal(firstTaskId, secondTaskId);

    // 4. Verify in MongoDB: exactly 1 task exists for this title and workspace
    const taskCount = await TaskModel.countDocuments({
      workspace: testWorkspaceId,
      title: payload.title,
    });
    assert.equal(taskCount, 1);

    // Verify idempotency record
    const record = await IdempotencyModel.findOne({
      userId: userAId,
      key,
      operation: IdempotencyOperation.CREATE_TASK,
      workspaceId: testWorkspaceId,
    });
    assert.ok(record);
    assert.equal(record.status, IdempotencyStatus.COMPLETED);
    assert.equal(record.responseStatus, 201);
  });

  test("5. Same key with different payload returns 409 Conflict (IDEMPOTENCY_KEY_REUSED)", async () => {
    const key = crypto.randomUUID();
    const payload1 = {
      title: "Task A - Original Payload",
      priority: "LOW",
      status: "TODO",
    };
    const payload2 = {
      title: "Task B - Modified Payload With Same Key",
      priority: "HIGH",
      status: "IN_PROGRESS",
    };

    await createTaskService(testWorkspaceId, testProjectId, userAId, payload1, key);

    await assert.rejects(
      async () => {
        await createTaskService(testWorkspaceId, testProjectId, userAId, payload2, key);
      },
      (err: any) => {
        assert.ok(err instanceof ConflictException);
        assert.equal(err.statusCode, 409);
        assert.equal(err.errorCode, ErrorCodeEnum.IDEMPOTENCY_KEY_REUSED);
        return true;
      }
    );
  });

  test("6. Missing idempotency key validation returns 400 Bad Request", () => {
    assert.throws(
      () => validateIdempotencyKey(undefined),
      (err: any) => {
        assert.ok(err instanceof BadRequestException);
        assert.equal(err.statusCode, 400);
        assert.equal(err.errorCode, ErrorCodeEnum.IDEMPOTENCY_KEY_REQUIRED);
        return true;
      }
    );

    assert.throws(
      () => validateIdempotencyKey(""),
      (err: any) => {
        assert.ok(err instanceof BadRequestException);
        assert.equal(err.statusCode, 400);
        assert.equal(err.errorCode, ErrorCodeEnum.IDEMPOTENCY_KEY_REQUIRED);
        return true;
      }
    );
  });

  test("7. Malformed idempotency key validation returns 400 Bad Request", () => {
    assert.throws(
      () => validateIdempotencyKey("not-a-valid-uuid-1234"),
      (err: any) => {
        assert.ok(err instanceof BadRequestException);
        assert.equal(err.statusCode, 400);
        assert.equal(err.errorCode, ErrorCodeEnum.IDEMPOTENCY_KEY_INVALID);
        return true;
      }
    );
  });

  // --- Project Creation Idempotency ---

  test("8 & 9 & 10 & 11. New project creation and repeated execution with same key returns identical project and creates 1 document", async () => {
    const key = crypto.randomUUID();
    const payload = {
      name: "Idempotent Mobile App",
      description: "Developing native application",
      emoji: "📱",
    };

    // 8. First request
    const firstResult = await createProjectService(
      userAId,
      testWorkspaceId,
      payload,
      key
    );

    assert.ok(firstResult.project);
    assert.equal(firstResult.isIdempotentReplay, false);
    const firstProjectId = (firstResult.project as any)._id.toString();

    // 9. Repeated request
    const secondResult = await createProjectService(
      userAId,
      testWorkspaceId,
      payload,
      key
    );

    // 10. Both contain identical project ID
    assert.ok(secondResult.project);
    assert.equal(secondResult.isIdempotentReplay, true);
    const secondProjectId = (secondResult.project as any)._id.toString();
    assert.equal(firstProjectId, secondProjectId);

    // 11. Only 1 project created in DB
    const projectCount = await ProjectModel.countDocuments({
      workspace: testWorkspaceId,
      name: payload.name,
    });
    assert.equal(projectCount, 1);
  });

  test("12. Same key with different project payload returns 409 Conflict (IDEMPOTENCY_KEY_REUSED)", async () => {
    const key = crypto.randomUUID();
    const payload1 = {
      name: "Original Project Name",
      description: "Desc 1",
      emoji: "🚀",
    };
    const payload2 = {
      name: "Different Project Name",
      description: "Desc 2",
      emoji: "💡",
    };

    await createProjectService(userAId, testWorkspaceId, payload1, key);

    await assert.rejects(
      async () => {
        await createProjectService(userAId, testWorkspaceId, payload2, key);
      },
      (err: any) => {
        assert.ok(err instanceof ConflictException);
        assert.equal(err.statusCode, 409);
        assert.equal(err.errorCode, ErrorCodeEnum.IDEMPOTENCY_KEY_REUSED);
        return true;
      }
    );
  });

  // --- Scope Isolation ---

  test("13. Scope Isolation: Same key used for CREATE_TASK and CREATE_PROJECT does not collide", async () => {
    const sharedKey = crypto.randomUUID();

    const taskResult = await createTaskService(
      testWorkspaceId,
      testProjectId,
      userAId,
      {
        title: "Shared Key Task",
        priority: "MEDIUM",
        status: "TODO",
      },
      sharedKey
    );

    const projectResult = await createProjectService(
      userAId,
      testWorkspaceId,
      {
        name: "Shared Key Project",
        emoji: "🎯",
      },
      sharedKey
    );

    assert.ok(taskResult.task);
    assert.ok(projectResult.project);

    // Verify both records exist under distinct operations
    const taskRecord = await IdempotencyModel.findOne({
      userId: userAId,
      key: sharedKey,
      operation: IdempotencyOperation.CREATE_TASK,
    });
    const projectRecord = await IdempotencyModel.findOne({
      userId: userAId,
      key: sharedKey,
      operation: IdempotencyOperation.CREATE_PROJECT,
    });

    assert.ok(taskRecord);
    assert.ok(projectRecord);
    assert.notEqual((taskRecord as any)._id.toString(), (projectRecord as any)._id.toString());
  });

  test("14. User Scope Isolation: Same key used by User A and User B operates independently", async () => {
    const sharedKey = crypto.randomUUID();

    const userAResult = await createTaskService(
      testWorkspaceId,
      testProjectId,
      userAId,
      {
        title: "User A Task",
        priority: "LOW",
        status: "TODO",
      },
      sharedKey
    );

    const userBResult = await createTaskService(
      otherWorkspaceId,
      otherProjectId,
      userBId,
      {
        title: "User B Task",
        priority: "HIGH",
        status: "TODO",
      },
      sharedKey
    );

    assert.ok(userAResult.task);
    assert.ok(userBResult.task);
    assert.notEqual(
      (userAResult.task as any)._id.toString(),
      (userBResult.task as any)._id.toString()
    );
  });

  test("15. Workspace Scope Isolation: Same key in different workspaces operate independently", async () => {
    const sharedKey = crypto.randomUUID();

    const ws1Result = await createProjectService(
      userAId,
      testWorkspaceId,
      {
        name: "Workspace A Project",
        emoji: "🅰️",
      },
      sharedKey
    );

    const ws2Result = await createProjectService(
      userAId,
      otherWorkspaceId,
      {
        name: "Workspace B Project",
        emoji: "🅱️",
      },
      sharedKey
    );

    assert.ok(ws1Result.project);
    assert.ok(ws2Result.project);
    assert.notEqual(
      (ws1Result.project as any)._id.toString(),
      (ws2Result.project as any)._id.toString()
    );
  });

  test("16. Operations do not accidentally replay each other's responses", async () => {
    const sharedKey = crypto.randomUUID();

    const taskResult = await createTaskService(
      testWorkspaceId,
      testProjectId,
      userAId,
      { title: "Distinct Operation Task", priority: "MEDIUM", status: "TODO" },
      sharedKey
    );

    const projectResult = await createProjectService(
      userAId,
      testWorkspaceId,
      { name: "Distinct Operation Project", emoji: "📁" },
      sharedKey
    );

    assert.ok((taskResult.task as any).title);
    assert.ok((projectResult.project as any).name);
    assert.equal((taskResult.task as any).title, "Distinct Operation Task");
    assert.equal((projectResult.project as any).name, "Distinct Operation Project");
  });

  // --- Failure & Transaction Abort Handling ---

  test("17 & 19. Failed task creation (e.g. invalid project ID) aborts transaction and does not leave a completed idempotency record", async () => {
    const key = crypto.randomUUID();
    const fakeProjectId = new mongoose.Types.ObjectId().toString();

    await assert.rejects(async () => {
      await createTaskService(
        testWorkspaceId,
        fakeProjectId,
        userAId,
        {
          title: "Failed Task Creation",
          priority: "HIGH",
          status: "TODO",
        },
        key
      );
    });

    // Verify NO completed record exists in Idempotency collection
    const record = await IdempotencyModel.findOne({
      userId: userAId,
      key,
      workspaceId: testWorkspaceId,
    });
    assert.equal(record, null);

    // 19. Now retrying with a VALID project ID using the SAME key succeeds cleanly!
    const retryResult = await createTaskService(
      testWorkspaceId,
      testProjectId,
      userAId,
      {
        title: "Retried Task After Abort",
        priority: "HIGH",
        status: "TODO",
      },
      key
    );

    assert.ok(retryResult.task);
    assert.equal(retryResult.isIdempotentReplay, false);
  });

  test("18. Failed project creation does not leave an idempotency record", async () => {
    const key = crypto.randomUUID();

    // Trigger validation failure by passing empty/invalid name
    await assert.rejects(async () => {
      await createProjectService(
        userAId,
        testWorkspaceId,
        {
          name: "", // Invalid name
        },
        key
      );
    });

    const record = await IdempotencyModel.findOne({
      userId: userAId,
      key,
      workspaceId: testWorkspaceId,
    });
    assert.equal(record, null);
  });

  test("20. Simulated lost HTTP response: caller re-sends request with same key and retrieves original resource safely", async () => {
    const key = crypto.randomUUID();
    const payload = {
      title: "Task with Simulated Network Timeout",
      priority: "MEDIUM",
      status: "TODO",
    };

    // Client sends request; server commits task and idempotency record
    const originalCall = await createTaskService(
      testWorkspaceId,
      testProjectId,
      userAId,
      payload,
      key
    );
    const createdId = (originalCall.task as any)._id.toString();

    // Client's network dropped the response. Client retries with same key:
    const recoveredCall = await createTaskService(
      testWorkspaceId,
      testProjectId,
      userAId,
      payload,
      key
    );

    assert.equal(recoveredCall.isIdempotentReplay, true);
    assert.equal((recoveredCall.task as any)._id.toString(), createdId);
  });

  // --- Concurrency Tests ---

  test("21 & 22 & 23. Concurrent task creation: simultaneous identical requests create exactly ONE task and return the same task ID", async () => {
    const key = crypto.randomUUID();
    const payload = {
      title: "Concurrent Task Creation Target",
      priority: "HIGH",
      status: "TODO",
    };

    // Send 3 simultaneous requests with the exact same key, workspace, project, and payload
    const results = await Promise.all([
      createTaskService(testWorkspaceId, testProjectId, userAId, payload, key),
      createTaskService(testWorkspaceId, testProjectId, userAId, payload, key),
      createTaskService(testWorkspaceId, testProjectId, userAId, payload, key),
    ]);

    // All 3 requests must resolve successfully (one created, two replayed or all matching)
    assert.equal(results.length, 3);

    const taskIds = results.map((r) => (r.task as any)._id.toString());
    assert.equal(taskIds[0], taskIds[1]);
    assert.equal(taskIds[1], taskIds[2]);

    // 22. Exactly ONE task must exist in MongoDB
    const count = await TaskModel.countDocuments({
      workspace: testWorkspaceId,
      title: payload.title,
    });
    assert.equal(count, 1, "Exactly one task document must be created in MongoDB");
  });

  test("24. Concurrent project creation: simultaneous identical requests create exactly ONE project and return the same project ID", async () => {
    const key = crypto.randomUUID();
    const payload = {
      name: "Concurrent Project Target",
      description: "Testing concurrency in project creation",
      emoji: "⚡",
    };

    // Send 3 simultaneous project creation requests
    const results = await Promise.all([
      createProjectService(userAId, testWorkspaceId, payload, key),
      createProjectService(userAId, testWorkspaceId, payload, key),
      createProjectService(userAId, testWorkspaceId, payload, key),
    ]);

    assert.equal(results.length, 3);

    const projectIds = results.map((r) => (r.project as any)._id.toString());
    assert.equal(projectIds[0], projectIds[1]);
    assert.equal(projectIds[1], projectIds[2]);

    // Exactly ONE project document created in MongoDB
    const count = await ProjectModel.countDocuments({
      workspace: testWorkspaceId,
      name: payload.name,
    });
    assert.equal(count, 1, "Exactly one project document must be created in MongoDB");
  });
});
