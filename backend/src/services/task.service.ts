import { TaskPriorityEnum, TaskStatusEnum } from "../enums/task.enum";
import MemberModel from "../models/member.model";
import ProjectModel from "../models/project.model";
import TaskModel from "../models/task.model";
import { BadRequestException, ConflictException, NotFoundException } from "../utils/appError";
import { config } from "../config/app.config";

const getLockOwnerId = (lockOwner: any): string | null => {
  if (!lockOwner) return null;
  return lockOwner._id ? lockOwner._id.toString() : lockOwner.toString();
};

export const createTaskService = async (
  workspaceId: string,
  projectId: string,
  userId: string,
  body: {
    title: string;
    description?: string;
    priority: string;
    status: string;
    assignedTo?: string | null;
    dueDate?: string;
  }
) => {
  const { title, description, priority, status, assignedTo, dueDate } = body;

  const project = await ProjectModel.findById(projectId);

  if (!project || project.workspace.toString() !== workspaceId.toString()) {
    throw new NotFoundException(
      "Project not found or does not belong to this workspace"
    );
  }
  if (assignedTo) {
    const isAssignedUserMember = await MemberModel.exists({
      userId: assignedTo,
      workspaceId,
    });

    if (!isAssignedUserMember) {
      throw new Error("Assigned user is not a member of this workspace.");
    }
  }
  const task = new TaskModel({
    title,
    description,
    priority: priority || TaskPriorityEnum.MEDIUM,
    status: status || TaskStatusEnum.TODO,
    assignedTo,
    createdBy: userId,
    workspace: workspaceId,
    project: projectId,
    dueDate,
    lockOwner: null,
    lockExpiresAt: null,
    lockVersion: 0,
  });

  await task.save();

  return { task };
};

export const claimTaskService = async (
  workspaceId: string,
  projectId: string,
  taskId: string,
  userId: string
) => {
  const project = await ProjectModel.findById(projectId);
  if (!project || project.workspace.toString() !== workspaceId.toString()) {
    throw new NotFoundException(
      "Project not found or does not belong to this workspace"
    );
  }

  const existingTask = await TaskModel.findOne({
    _id: taskId,
    workspace: workspaceId,
    project: projectId,
  }).populate("lockOwner", "_id name profilePicture");

  if (!existingTask) {
    throw new NotFoundException(
      "Task not found or does not belong to this project/workspace"
    );
  }

  const now = new Date();
  const leaseDurationMs = (config.TASK_LOCK_LEASE_DURATION_SEC || 300) * 1000;

  // Safe idempotent check: If the same user already holds an unexpired lock, return current lock state
  if (
    existingTask.lockOwner &&
    existingTask.lockOwner._id.toString() === userId.toString() &&
    existingTask.lockExpiresAt &&
    existingTask.lockExpiresAt.getTime() > now.getTime()
  ) {
    return {
      task: existingTask,
      lockVersion: existingTask.lockVersion,
      lockExpiresAt: existingTask.lockExpiresAt,
      isAlreadyOwner: true,
    };
  }

  // If another user holds an unexpired lock, reject with 409 Conflict
  if (
    existingTask.lockOwner &&
    existingTask.lockOwner._id.toString() !== userId.toString() &&
    existingTask.lockExpiresAt &&
    existingTask.lockExpiresAt.getTime() > now.getTime()
  ) {
    const ownerName = (existingTask.lockOwner as any)?.name || "Another member";
    throw new ConflictException(
      `Task is currently locked by ${ownerName} until ${existingTask.lockExpiresAt.toISOString()}`
    );
  }

  // Atomic lock acquisition: Unlocked or Expired
  const newExpiresAt = new Date(now.getTime() + leaseDurationMs);

  const acquiredTask = await TaskModel.findOneAndUpdate(
    {
      _id: taskId,
      workspace: workspaceId,
      project: projectId,
      $or: [
        { lockOwner: null },
        { lockExpiresAt: null },
        { lockExpiresAt: { $lte: now } },
      ],
    },
    {
      $set: {
        lockOwner: userId,
        lockExpiresAt: newExpiresAt,
      },
      $inc: {
        lockVersion: 1,
      },
    },
    { new: true }
  )
    .populate("assignedTo", "_id name profilePicture -password")
    .populate("project", "_id emoji name")
    .populate("lockOwner", "_id name profilePicture");

  if (!acquiredTask) {
    // Concurrent race condition: another request claimed the lock simultaneously
    const conflictTask = await TaskModel.findById(taskId).populate(
      "lockOwner",
      "name"
    );
    const ownerName = (conflictTask?.lockOwner as any)?.name || "another user";
    throw new ConflictException(
      `Task was just claimed by ${ownerName}. Please try again later.`
    );
  }

  return {
    task: acquiredTask,
    lockVersion: acquiredTask.lockVersion,
    lockExpiresAt: acquiredTask.lockExpiresAt,
    isAlreadyOwner: false,
  };
};

export const renewTaskService = async (
  workspaceId: string,
  projectId: string,
  taskId: string,
  userId: string,
  lockVersion: number
) => {
  const project = await ProjectModel.findById(projectId);
  if (!project || project.workspace.toString() !== workspaceId.toString()) {
    throw new NotFoundException(
      "Project not found or does not belong to this workspace"
    );
  }

  const now = new Date();
  const leaseDurationMs = (config.TASK_LOCK_LEASE_DURATION_SEC || 300) * 1000;
  const newExpiresAt = new Date(now.getTime() + leaseDurationMs);

  // Atomic renewal: only current owner, matching version, active lease
  const renewedTask = await TaskModel.findOneAndUpdate(
    {
      _id: taskId,
      workspace: workspaceId,
      project: projectId,
      lockOwner: userId,
      lockVersion: lockVersion,
      lockExpiresAt: { $gt: now },
    },
    {
      $set: {
        lockExpiresAt: newExpiresAt,
      },
    },
    { new: true }
  )
    .populate("assignedTo", "_id name profilePicture -password")
    .populate("project", "_id emoji name")
    .populate("lockOwner", "_id name profilePicture");

  if (!renewedTask) {
    const task = await TaskModel.findOne({
      _id: taskId,
      workspace: workspaceId,
      project: projectId,
    }).populate("lockOwner", "name");

    if (!task) {
      throw new NotFoundException(
        "Task not found or does not belong to this project/workspace"
      );
    }
    if (
      !task.lockOwner ||
      (task.lockExpiresAt && task.lockExpiresAt.getTime() <= now.getTime())
    ) {
      throw new ConflictException("Lock has expired. Please claim the task again.");
    }
    if (getLockOwnerId(task.lockOwner) !== userId.toString()) {
      const ownerName = (task.lockOwner as any)?.name || "another user";
      throw new ConflictException(`Lock is currently owned by ${ownerName}.`);
    }
    if (task.lockVersion !== lockVersion) {
      throw new ConflictException(
        "Lock version mismatch. The task lock has been modified."
      );
    }
    throw new ConflictException("Failed to renew task lock.");
  }

  return {
    task: renewedTask,
    lockVersion: renewedTask.lockVersion,
    lockExpiresAt: renewedTask.lockExpiresAt,
  };
};

export const releaseTaskService = async (
  workspaceId: string,
  projectId: string,
  taskId: string,
  userId: string,
  lockVersion: number
) => {
  const project = await ProjectModel.findById(projectId);
  if (!project || project.workspace.toString() !== workspaceId.toString()) {
    throw new NotFoundException(
      "Project not found or does not belong to this workspace"
    );
  }

  // Atomic release: only current owner with matching lockVersion
  const releasedTask = await TaskModel.findOneAndUpdate(
    {
      _id: taskId,
      workspace: workspaceId,
      project: projectId,
      lockOwner: userId,
      lockVersion: lockVersion,
    },
    {
      $set: {
        lockOwner: null,
        lockExpiresAt: null,
      },
    },
    { new: true }
  )
    .populate("assignedTo", "_id name profilePicture -password")
    .populate("project", "_id emoji name");

  if (!releasedTask) {
    const task = await TaskModel.findOne({
      _id: taskId,
      workspace: workspaceId,
      project: projectId,
    }).populate("lockOwner", "name");

    if (!task) {
      throw new NotFoundException(
        "Task not found or does not belong to this project/workspace"
      );
    }
    if (!task.lockOwner) {
      return { message: "Task lock is already released" };
    }
    if (getLockOwnerId(task.lockOwner) !== userId.toString()) {
      const ownerName = (task.lockOwner as any)?.name || "another user";
      throw new ConflictException(
        `Cannot release lock: actively owned by ${ownerName}.`
      );
    }
    if (task.lockVersion !== lockVersion) {
      throw new ConflictException(
        "Lock version mismatch. The task lock was already updated or reclaimed."
      );
    }
    throw new ConflictException("Failed to release task lock.");
  }

  return { message: "Lock released successfully", task: releasedTask };
};

export const updateTaskService = async (
  workspaceId: string,
  projectId: string,
  taskId: string,
  userId: string,
  body: {
    title: string;
    description?: string;
    priority: string;
    status: string;
    assignedTo?: string | null;
    dueDate?: string;
    lockVersion: number;
  }
) => {
  const project = await ProjectModel.findById(projectId);

  if (!project || project.workspace.toString() !== workspaceId.toString()) {
    throw new NotFoundException(
      "Project not found or does not belong to this workspace"
    );
  }

  if (body.assignedTo) {
    const isAssignedUserMember = await MemberModel.exists({
      userId: body.assignedTo,
      workspaceId,
    });

    if (!isAssignedUserMember) {
      throw new BadRequestException("Assigned user is not a member of this workspace.");
    }
  }

  const now = new Date();

  // Atomic write: requires task scope, lockOwner === userId, lockVersion === body.lockVersion, and unexpired lease
  const updatedTask = await TaskModel.findOneAndUpdate(
    {
      _id: taskId,
      workspace: workspaceId,
      project: projectId,
      lockOwner: userId,
      lockVersion: body.lockVersion,
      lockExpiresAt: { $gt: now },
    },
    {
      $set: {
        title: body.title,
        description: body.description,
        priority: body.priority,
        status: body.status,
        assignedTo: body.assignedTo,
        dueDate: body.dueDate,
      },
    },
    { new: true }
  )
    .populate("assignedTo", "_id name profilePicture -password")
    .populate("project", "_id emoji name")
    .populate("lockOwner", "_id name profilePicture");

  if (!updatedTask) {
    const task = await TaskModel.findOne({
      _id: taskId,
      workspace: workspaceId,
      project: projectId,
    }).populate("lockOwner", "name");

    if (!task) {
      throw new NotFoundException(
        "Task not found or does not belong to this project"
      );
    }
    if (
      !task.lockOwner ||
      !task.lockExpiresAt ||
      task.lockExpiresAt.getTime() <= now.getTime()
    ) {
      throw new ConflictException(
        "You do not hold an active lock on this task or your lock has expired. Please claim the task before editing."
      );
    }
    if (getLockOwnerId(task.lockOwner) !== userId.toString()) {
      const ownerName = (task.lockOwner as any)?.name || "another user";
      throw new ConflictException(
        `Task is currently locked by ${ownerName}. You cannot modify it.`
      );
    }
    if (task.lockVersion !== body.lockVersion) {
      throw new ConflictException(
        "Lock version mismatch. The task has been modified or reclaimed. Please refresh."
      );
    }
    throw new BadRequestException("Failed to update task");
  }

  return { updatedTask };
};

export const getAllTasksService = async (
  workspaceId: string,
  filters: {
    projectId?: string;
    status?: string[];
    priority?: string[];
    assignedTo?: string[];
    keyword?: string;
    dueDate?: string;
  },
  pagination: {
    pageSize: number;
    pageNumber: number;
  }
) => {
  const query: Record<string, any> = {
    workspace: workspaceId,
  };

  if (filters.projectId) {
    query.project = filters.projectId;
  }

  if (filters.status && filters.status?.length > 0) {
    query.status = { $in: filters.status };
  }

  if (filters.priority && filters.priority?.length > 0) {
    query.priority = { $in: filters.priority };
  }

  if (filters.assignedTo && filters.assignedTo?.length > 0) {
    query.assignedTo = { $in: filters.assignedTo };
  }

  if (filters.keyword && filters.keyword !== undefined) {
    query.title = { $regex: filters.keyword, $options: "i" };
  }

  if (filters.dueDate) {
    query.dueDate = {
      $eq: new Date(filters.dueDate),
    };
  }

  //Pagination Setup
  const { pageSize, pageNumber } = pagination;
  const skip = (pageNumber - 1) * pageSize;

  const [tasks, totalCount] = await Promise.all([
    TaskModel.find(query)
      .skip(skip)
      .limit(pageSize)
      .sort({ createdAt: -1 })
      .populate("assignedTo", "_id name profilePicture -password")
      .populate("project", "_id emoji name")
      .populate("lockOwner", "_id name profilePicture"),
    TaskModel.countDocuments(query),
  ]);

  const totalPages = Math.ceil(totalCount / pageSize);

  return {
    tasks,
    pagination: {
      pageSize,
      pageNumber,
      totalCount,
      totalPages,
      skip,
    },
  };
};

export const getTaskByIdService = async (
  workspaceId: string,
  projectId: string,
  taskId: string
) => {
  const project = await ProjectModel.findById(projectId);

  if (!project || project.workspace.toString() !== workspaceId.toString()) {
    throw new NotFoundException(
      "Project not found or does not belong to this workspace"
    );
  }

  const task = await TaskModel.findOne({
    _id: taskId,
    workspace: workspaceId,
    project: projectId,
  })
    .populate("assignedTo", "_id name profilePicture -password")
    .populate("lockOwner", "_id name profilePicture");

  if (!task) {
    throw new NotFoundException("Task not found.");
  }

  return task;
};

export const deleteTaskService = async (
  workspaceId: string,
  taskId: string,
  userId: string
) => {
  const now = new Date();

  // Atomic delete: delete allowed only if task is unlocked, expired, or locked by this user
  const task = await TaskModel.findOneAndDelete({
    _id: taskId,
    workspace: workspaceId,
    $or: [
      { lockOwner: null },
      { lockExpiresAt: null },
      { lockExpiresAt: { $lte: now } },
      { lockOwner: userId },
    ],
  });

  if (!task) {
    const existingTask = await TaskModel.findOne({
      _id: taskId,
      workspace: workspaceId,
    }).populate("lockOwner", "name");

    if (!existingTask) {
      throw new NotFoundException(
        "Task not found or does not belong to the specified workspace"
      );
    }

    const ownerName = (existingTask.lockOwner as any)?.name || "another user";
    throw new ConflictException(
      `Cannot delete task while it is actively locked by ${ownerName}.`
    );
  }

  return;
};
