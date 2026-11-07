import "dotenv/config";
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { config } from "../config/app.config";
import TaskModel from "../models/task.model";
import ProjectModel from "../models/project.model";
import WorkspaceModel from "../models/workspace.model";
import UserModel from "../models/user.model";
import {
  claimTaskService,
  createTaskService,
  deleteTaskService,
  releaseTaskService,
  renewTaskService,
  updateTaskService,
} from "../services/task.service";
import { ConflictException, NotFoundException } from "../utils/appError";

describe("Pessimistic Locking Mechanism Test Suite", () => {
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
      name: "Test User A",
      email: `test_user_a_${Date.now()}@example.com`,
      password: "password123",
    });
    userAId = userA._id.toString();

    const userB: any = await UserModel.create({
      name: "Test User B",
      email: `test_user_b_${Date.now()}@example.com`,
      password: "password123",
    });
    userBId = userB._id.toString();

    // Create test workspaces
    const workspaceA: any = await WorkspaceModel.create({
      name: `Lock Test Workspace ${Date.now()}`,
      owner: userA._id,
      inviteCode: `INV-${Date.now()}-A`,
    });
    testWorkspaceId = workspaceA._id.toString();

    const workspaceB: any = await WorkspaceModel.create({
      name: `Other Workspace ${Date.now()}`,
      owner: userB._id,
      inviteCode: `INV-${Date.now()}-B`,
    });
    otherWorkspaceId = workspaceB._id.toString();

    // Create test projects
    const projectA: any = await ProjectModel.create({
      name: "Test Project A",
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
    // Clean up test data
    await TaskModel.deleteMany({ workspace: { $in: [testWorkspaceId, otherWorkspaceId] } });
    await ProjectModel.deleteMany({ _id: { $in: [testProjectId, otherProjectId] } });
    await WorkspaceModel.deleteMany({ _id: { $in: [testWorkspaceId, otherWorkspaceId] } });
    await UserModel.deleteMany({ _id: { $in: [userAId, userBId] } });
    await mongoose.disconnect();
  });

  test("1. Successful task claim by User A", async () => {
    const { task } = await createTaskService(
      testWorkspaceId,
      testProjectId,
      userAId,
      {
        title: "Test Task for Claiming",
        priority: "MEDIUM",
        status: "TODO",
      }
    );

    const taskId = (task as any)._id.toString();

    const claimResult = await claimTaskService(
      testWorkspaceId,
      testProjectId,
      taskId,
      userAId
    );

    assert.ok(claimResult.task);
    assert.equal(claimResult.lockVersion, 1);
    assert.equal(claimResult.isAlreadyOwner, false);
    assert.ok(claimResult.lockExpiresAt);
    assert.ok(new Date(claimResult.lockExpiresAt!).getTime() > Date.now());

    // Verify in database
    const dbTask = await TaskModel.findById(taskId);
    assert.equal(dbTask?.lockOwner?.toString(), userAId);
    assert.equal(dbTask?.lockVersion, 1);
  });

  test("2. Second user (User B) receiving 409 Conflict when attempting to claim an actively locked task", async () => {
    const { task } = await createTaskService(
      testWorkspaceId,
      testProjectId,
      userAId,
      {
        title: "Active Lock Conflict Task",
        priority: "HIGH",
        status: "TODO",
      }
    );
    const taskId = (task as any)._id.toString();

    // User A claims first
    await claimTaskService(testWorkspaceId, testProjectId, taskId, userAId);

    // User B tries to claim while User A's lock is active
    await assert.rejects(
      async () => {
        await claimTaskService(testWorkspaceId, testProjectId, taskId, userBId);
      },
      (err: any) => {
        assert.ok(err instanceof ConflictException);
        assert.equal(err.statusCode, 409);
        assert.match(err.message, /currently locked/i);
        return true;
      }
    );
  });

  test("3. Safe idempotency: Repeated claim by the same lock owner returns active lock without modifying version", async () => {
    const { task } = await createTaskService(
      testWorkspaceId,
      testProjectId,
      userAId,
      {
        title: "Idempotent Claim Task",
        priority: "LOW",
        status: "TODO",
      }
    );
    const taskId = (task as any)._id.toString();

    const firstClaim = await claimTaskService(testWorkspaceId, testProjectId, taskId, userAId);
    assert.equal(firstClaim.lockVersion, 1);
    assert.equal(firstClaim.isAlreadyOwner, false);

    // Repeat claim by same user
    const secondClaim = await claimTaskService(testWorkspaceId, testProjectId, taskId, userAId);
    assert.equal(secondClaim.lockVersion, 1);
    assert.equal(secondClaim.isAlreadyOwner, true);
  });

  test("4. Successful lock renewal by the owner", async () => {
    const { task } = await createTaskService(
      testWorkspaceId,
      testProjectId,
      userAId,
      {
        title: "Renewal Test Task",
        priority: "MEDIUM",
        status: "TODO",
      }
    );
    const taskId = (task as any)._id.toString();

    const claim = await claimTaskService(testWorkspaceId, testProjectId, taskId, userAId);
    const initialExpiry = new Date(claim.lockExpiresAt!).getTime();

    // Wait a brief moment then renew
    await new Promise((resolve) => setTimeout(resolve, 50));

    const renewResult = await renewTaskService(
      testWorkspaceId,
      testProjectId,
      taskId,
      userAId,
      claim.lockVersion
    );

    assert.ok(renewResult.task);
    assert.equal(renewResult.lockVersion, claim.lockVersion);
    const renewedExpiry = new Date(renewResult.lockExpiresAt!).getTime();
    assert.ok(renewedExpiry >= initialExpiry);
  });

  test("5. Rejection of renewal by another user (User B) with 409 Conflict", async () => {
    const { task } = await createTaskService(
      testWorkspaceId,
      testProjectId,
      userAId,
      {
        title: "Unauthorized Renewal Task",
        priority: "MEDIUM",
        status: "TODO",
      }
    );
    const taskId = (task as any)._id.toString();

    const claim = await claimTaskService(testWorkspaceId, testProjectId, taskId, userAId);

    await assert.rejects(
      async () => {
        await renewTaskService(
          testWorkspaceId,
          testProjectId,
          taskId,
          userBId,
          claim.lockVersion
        );
      },
      (err: any) => {
        assert.ok(err instanceof ConflictException);
        assert.equal(err.statusCode, 409);
        return true;
      }
    );
  });

  test("6. Successful lock release by the owner", async () => {
    const { task } = await createTaskService(
      testWorkspaceId,
      testProjectId,
      userAId,
      {
        title: "Release Test Task",
        priority: "MEDIUM",
        status: "TODO",
      }
    );
    const taskId = (task as any)._id.toString();

    const claim = await claimTaskService(testWorkspaceId, testProjectId, taskId, userAId);
    assert.equal(claim.lockVersion, 1);

    const releaseResult = await releaseTaskService(
      testWorkspaceId,
      testProjectId,
      taskId,
      userAId,
      claim.lockVersion
    );

    assert.ok(releaseResult.message);

    // Verify task is now unlocked in database, and lockVersion is preserved monotonically
    const dbTask = await TaskModel.findById(taskId);
    assert.equal(dbTask?.lockOwner, null);
    assert.equal(dbTask?.lockExpiresAt, null);
    assert.equal(dbTask?.lockVersion, 1);
  });

  test("7. Rejection of release by a non-owner", async () => {
    const { task } = await createTaskService(
      testWorkspaceId,
      testProjectId,
      userAId,
      {
        title: "Release Non-Owner Test",
        priority: "MEDIUM",
        status: "TODO",
      }
    );
    const taskId = (task as any)._id.toString();

    const claim = await claimTaskService(testWorkspaceId, testProjectId, taskId, userAId);

    await assert.rejects(
      async () => {
        await releaseTaskService(
          testWorkspaceId,
          testProjectId,
          taskId,
          userBId,
          claim.lockVersion
        );
      },
      (err: any) => {
        assert.ok(err instanceof ConflictException);
        assert.equal(err.statusCode, 409);
        return true;
      }
    );
  });

  test("8. Reclaiming an expired lock: User B can claim after User A's lease expires", async () => {
    const { task } = await createTaskService(
      testWorkspaceId,
      testProjectId,
      userAId,
      {
        title: "Expired Lock Task",
        priority: "MEDIUM",
        status: "TODO",
      }
    );
    const taskId = (task as any)._id.toString();

    // Claim as User A
    const claimA = await claimTaskService(testWorkspaceId, testProjectId, taskId, userAId);
    assert.equal(claimA.lockVersion, 1);

    // Force expire the lock in the database directly
    const expiredTime = new Date(Date.now() - 10000); // 10 seconds ago
    await TaskModel.findByIdAndUpdate(taskId, {
      lockExpiresAt: expiredTime,
    });

    // User B should now be able to claim the expired task!
    const claimB = await claimTaskService(testWorkspaceId, testProjectId, taskId, userBId);
    assert.equal(claimB.lockVersion, 2); // Monotonically incremented to 2
    assert.equal(claimB.isAlreadyOwner, false);

    const dbTask = await TaskModel.findById(taskId);
    assert.equal(dbTask?.lockOwner?.toString(), userBId);
    assert.equal(dbTask?.lockVersion, 2);
  });

  test("9. Rejection of task updates without a lock", async () => {
    const { task } = await createTaskService(
      testWorkspaceId,
      testProjectId,
      userAId,
      {
        title: "Unlocked Task for Update",
        priority: "MEDIUM",
        status: "TODO",
      }
    );
    const taskId = (task as any)._id.toString();

    // Try to update without holding a lock
    await assert.rejects(
      async () => {
        await updateTaskService(
          testWorkspaceId,
          testProjectId,
          taskId,
          userAId,
          {
            title: "Updated Title Without Lock",
            priority: "HIGH",
            status: "IN_PROGRESS",
            lockVersion: 0,
          }
        );
      },
      (err: any) => {
        assert.ok(err instanceof ConflictException);
        assert.equal(err.statusCode, 409);
        assert.match(err.message, /do not hold an active lock/i);
        return true;
      }
    );
  });

  test("10. Successful task update by current lock owner with matching lockVersion", async () => {
    const { task } = await createTaskService(
      testWorkspaceId,
      testProjectId,
      userAId,
      {
        title: "Task To Be Updated",
        priority: "MEDIUM",
        status: "TODO",
      }
    );
    const taskId = (task as any)._id.toString();

    const claim = await claimTaskService(testWorkspaceId, testProjectId, taskId, userAId);

    const { updatedTask } = await updateTaskService(
      testWorkspaceId,
      testProjectId,
      taskId,
      userAId,
      {
        title: "Successfully Updated Title",
        priority: "HIGH",
        status: "IN_PROGRESS",
        lockVersion: claim.lockVersion,
      }
    );

    assert.equal(updatedTask.title, "Successfully Updated Title");
    assert.equal(updatedTask.priority, "HIGH");
    assert.equal(updatedTask.status, "IN_PROGRESS");
  });

  test("11. Rejection of updates with an outdated lock version (fencing token check)", async () => {
    const { task } = await createTaskService(
      testWorkspaceId,
      testProjectId,
      userAId,
      {
        title: "Fencing Token Outdated Version Task",
        priority: "MEDIUM",
        status: "TODO",
      }
    );
    const taskId = (task as any)._id.toString();

    const claim = await claimTaskService(testWorkspaceId, testProjectId, taskId, userAId);
    assert.equal(claim.lockVersion, 1);

    // Attempt update with stale version 0
    await assert.rejects(
      async () => {
        await updateTaskService(
          testWorkspaceId,
          testProjectId,
          taskId,
          userAId,
          {
            title: "Trying Stale Version Update",
            priority: "HIGH",
            status: "IN_PROGRESS",
            lockVersion: 0, // Outdated!
          }
        );
      },
      (err: any) => {
        assert.ok(err instanceof ConflictException);
        assert.equal(err.statusCode, 409);
        assert.match(err.message, /lock version mismatch/i);
        return true;
      }
    );
  });

  test("12. Rejection of task modifications outside the user's workspace", async () => {
    const { task } = await createTaskService(
      testWorkspaceId,
      testProjectId,
      userAId,
      {
        title: "Workspace Scoping Task",
        priority: "MEDIUM",
        status: "TODO",
      }
    );
    const taskId = (task as any)._id.toString();

    await assert.rejects(
      async () => {
        await claimTaskService(
          otherWorkspaceId, // Wrong workspace
          testProjectId,
          taskId,
          userAId
        );
      },
      (err: any) => {
        assert.ok(err instanceof NotFoundException);
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });

  test("13. Deletion protection: Deletion rejected if task is actively locked by another user", async () => {
    const { task } = await createTaskService(
      testWorkspaceId,
      testProjectId,
      userAId,
      {
        title: "Task Protected from Deletion",
        priority: "MEDIUM",
        status: "TODO",
      }
    );
    const taskId = (task as any)._id.toString();

    // User A claims the task
    await claimTaskService(testWorkspaceId, testProjectId, taskId, userAId);

    // User B attempts to delete User A's locked task
    await assert.rejects(
      async () => {
        await deleteTaskService(testWorkspaceId, taskId, userBId);
      },
      (err: any) => {
        assert.ok(err instanceof ConflictException);
        assert.equal(err.statusCode, 409);
        assert.match(err.message, /actively locked/i);
        return true;
      }
    );

    // Lock owner (User A) is allowed to delete
    await deleteTaskService(testWorkspaceId, taskId, userAId);
    const checkDeleted = await TaskModel.findById(taskId);
    assert.equal(checkDeleted, null);
  });

  test("14. Concurrent acquisition: Two simultaneous claim requests result in exactly ONE active owner", async () => {
    const { task } = await createTaskService(
      testWorkspaceId,
      testProjectId,
      userAId,
      {
        title: "Concurrent Acquisition Task",
        priority: "HIGH",
        status: "TODO",
      }
    );
    const taskId = (task as any)._id.toString();

    // Simultaneously fire claims from User A and User B
    const results = await Promise.allSettled([
      claimTaskService(testWorkspaceId, testProjectId, taskId, userAId),
      claimTaskService(testWorkspaceId, testProjectId, taskId, userBId),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    assert.equal(fulfilled.length, 1, "Exactly one claim request must succeed");
    assert.equal(rejected.length, 1, "Exactly one claim request must be rejected with Conflict");

    const failedReason = (rejected[0] as PromiseRejectedResult).reason;
    assert.ok(failedReason instanceof ConflictException);
    assert.equal(failedReason.statusCode, 409);

    // Verify database state has a single owner and lockVersion === 1
    const dbTask = await TaskModel.findById(taskId);
    assert.ok(dbTask?.lockOwner);
    assert.equal(dbTask?.lockVersion, 1);
  });
});
