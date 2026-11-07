import { useState } from "react";
import { Row } from "@tanstack/react-table";
import {
  Lock,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Unlock,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/resuable/confirm-dialog";
import { TaskType } from "@/types/api.type";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import useWorkspaceId from "@/hooks/use-workspace-id";
import {
  claimTaskMutationFn,
  deleteTaskMutationFn,
  releaseTaskMutationFn,
  renewTaskMutationFn,
} from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import EditTaskDialog from "../edit-task-dialog";
import { useAuthContext } from "@/context/auth-provider";

interface DataTableRowActionsProps {
  row: Row<TaskType>;
}

export function DataTableRowActions({ row }: DataTableRowActionsProps) {
  const [openDeleteDialog, setOpenDialog] = useState(false);
  const [openEditDialog, setOpenEditDialog] = useState(false);

  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceId();
  const { user } = useAuthContext();

  const task = row.original;
  const taskId = task._id as string;
  const projectId = task.project?._id as string;
  const taskCode = task.taskCode;

  // Lock calculations
  const now = Date.now();
  const isLockActive =
    !!task.lockOwner &&
    !!task.lockExpiresAt &&
    new Date(task.lockExpiresAt).getTime() > now;

  const currentUserId = user?._id;
  const isLockedByMe = isLockActive && task.lockOwner?._id === currentUserId;
  const isLockedByOther = isLockActive && task.lockOwner?._id !== currentUserId;
  const lockOwnerName = task.lockOwner?.name || "Another member";

  // Mutations
  const { mutate: deleteTask, isPending: isDeletePending } = useMutation({
    mutationFn: deleteTaskMutationFn,
  });

  const { mutate: claimTask, isPending: isClaimPending } = useMutation({
    mutationFn: claimTaskMutationFn,
  });

  const { mutate: renewLock, isPending: isRenewPending } = useMutation({
    mutationFn: renewTaskMutationFn,
  });

  const { mutate: releaseLock, isPending: isReleasePending } = useMutation({
    mutationFn: releaseTaskMutationFn,
  });

  const handleClaim = (openEditAfter = false) => {
    claimTask(
      { taskId, projectId, workspaceId },
      {
        onSuccess: (data) => {
          queryClient.invalidateQueries({
            queryKey: ["all-tasks", workspaceId],
          });
          toast({
            title: "Task Claimed",
            description: data.message || "You now hold the exclusive lock for this task.",
            variant: "success",
          });
          if (openEditAfter) {
            setOpenEditDialog(true);
          }
        },
        onError: (error: any) => {
          toast({
            title: "Claim Failed",
            description: error.message || "Failed to claim task lock.",
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleRenew = () => {
    renewLock(
      {
        taskId,
        projectId,
        workspaceId,
        lockVersion: task.lockVersion ?? 0,
      },
      {
        onSuccess: (data) => {
          queryClient.invalidateQueries({
            queryKey: ["all-tasks", workspaceId],
          });
          toast({
            title: "Lock Renewed",
            description: data.message || "Your lock lease has been extended.",
            variant: "success",
          });
        },
        onError: (error: any) => {
          toast({
            title: "Renewal Failed",
            description: error.message || "Failed to renew task lock.",
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleRelease = () => {
    releaseLock(
      {
        taskId,
        projectId,
        workspaceId,
        lockVersion: task.lockVersion ?? 0,
      },
      {
        onSuccess: (data) => {
          queryClient.invalidateQueries({
            queryKey: ["all-tasks", workspaceId],
          });
          toast({
            title: "Lock Released",
            description: data.message || "Task lock has been released.",
            variant: "success",
          });
        },
        onError: (error: any) => {
          toast({
            title: "Release Failed",
            description: error.message || "Failed to release task lock.",
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleEditClick = () => {
    if (isLockedByOther) {
      toast({
        title: "Task Locked",
        description: `This task is currently locked by ${lockOwnerName}.`,
        variant: "destructive",
      });
      return;
    }

    if (isLockedByMe) {
      setOpenEditDialog(true);
      return;
    }

    // Unlocked or expired: auto-claim and then open edit dialog
    handleClaim(true);
  };

  const handleDeleteConfirm = () => {
    deleteTask(
      { workspaceId, taskId },
      {
        onSuccess: (data) => {
          queryClient.invalidateQueries({
            queryKey: ["all-tasks", workspaceId],
          });
          toast({
            title: "Success",
            description: data.message,
            variant: "success",
          });
          setTimeout(() => setOpenDialog(false), 100);
        },
        onError: (error: any) => {
          toast({
            title: "Delete Failed",
            description: error.message,
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="flex h-8 w-8 p-0 data-[state=open]:bg-muted"
          >
            <MoreHorizontal />
            <span className="sr-only">Open menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[190px]">
          {/* Claim / Lock management options */}
          {!isLockActive && (
            <DropdownMenuItem
              className="cursor-pointer text-emerald-600 focus:text-emerald-700 font-medium"
              disabled={isClaimPending}
              onClick={() => handleClaim(false)}
            >
              <ShieldCheck className="w-4 h-4 mr-2" /> Claim Task
            </DropdownMenuItem>
          )}

          {isLockedByMe && (
            <>
              <DropdownMenuItem
                className="cursor-pointer text-blue-600 focus:text-blue-700"
                disabled={isRenewPending}
                onClick={handleRenew}
              >
                <RefreshCw className="w-4 h-4 mr-2" /> Renew Lock
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer text-amber-600 focus:text-amber-700"
                disabled={isReleasePending}
                onClick={handleRelease}
              >
                <Unlock className="w-4 h-4 mr-2" /> Release Lock
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}

          {isLockedByOther && (
            <DropdownMenuItem disabled className="text-muted-foreground text-xs">
              <Lock className="w-3.5 h-3.5 mr-2" /> Locked by {lockOwnerName}
            </DropdownMenuItem>
          )}

          {/* Edit Task Option */}
          <DropdownMenuItem
            className="cursor-pointer"
            disabled={isLockedByOther || isClaimPending}
            onClick={handleEditClick}
          >
            <Pencil className="w-4 h-4 mr-2" />
            {isLockedByMe ? "Edit Task" : "Claim & Edit"}
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {/* Delete Task Option */}
          <DropdownMenuItem
            className="!text-destructive cursor-pointer"
            disabled={isLockedByOther || isDeletePending}
            onClick={() => setOpenDialog(true)}
          >
            Delete Task
            <DropdownMenuShortcut>⌘⌫</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Edit Task Dialog */}
      <EditTaskDialog
        task={task}
        isOpen={openEditDialog}
        onClose={() => setOpenEditDialog(false)}
      />

      {/* Delete Task Confirmation Dialog */}
      <ConfirmDialog
        isOpen={openDeleteDialog}
        isLoading={isDeletePending}
        onClose={() => setOpenDialog(false)}
        onConfirm={handleDeleteConfirm}
        title="Delete Task"
        description={
          isLockedByOther
            ? `Cannot delete ${taskCode}: task is actively locked by ${lockOwnerName}.`
            : `Are you sure you want to delete ${taskCode}?`
        }
        confirmText="Delete"
        cancelText="Cancel"
      />
    </>
  );
}
