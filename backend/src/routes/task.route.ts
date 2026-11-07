import { Router } from "express";
import {
  claimTaskController,
  createTaskController,
  deleteTaskController,
  getAllTasksController,
  getTaskByIdController,
  releaseTaskController,
  renewTaskController,
  updateTaskController,
} from "../controllers/task.controller";

const taskRoutes = Router();

taskRoutes.post(
  "/project/:projectId/workspace/:workspaceId/create",
  createTaskController
);

taskRoutes.delete("/:id/workspace/:workspaceId/delete", deleteTaskController);

taskRoutes.put(
  "/:id/project/:projectId/workspace/:workspaceId/update",
  updateTaskController
);

// Pessimistic Locking Routes
taskRoutes.put(
  "/:id/project/:projectId/workspace/:workspaceId/claim",
  claimTaskController
);
taskRoutes.post(
  "/:id/project/:projectId/workspace/:workspaceId/claim",
  claimTaskController
);

taskRoutes.put(
  "/:id/project/:projectId/workspace/:workspaceId/renew",
  renewTaskController
);
taskRoutes.post(
  "/:id/project/:projectId/workspace/:workspaceId/renew",
  renewTaskController
);

taskRoutes.put(
  "/:id/project/:projectId/workspace/:workspaceId/release",
  releaseTaskController
);
taskRoutes.post(
  "/:id/project/:projectId/workspace/:workspaceId/release",
  releaseTaskController
);

taskRoutes.get("/workspace/:workspaceId/all", getAllTasksController);

taskRoutes.get(
  "/:id/project/:projectId/workspace/:workspaceId",
  getTaskByIdController
);

export default taskRoutes;
