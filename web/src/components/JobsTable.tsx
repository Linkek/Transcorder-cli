import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Box,
  Typography,
  Chip,
  IconButton,
  Tooltip,
  Button,
  Stack,
  Menu,
  MenuItem,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material'
import {
  MaterialReactTable,
  useMaterialReactTable,
  type MRT_ColumnDef,
} from 'material-react-table'
import ReplayIcon from '@mui/icons-material/Replay'
import DeleteIcon from '@mui/icons-material/Delete'
import CleaningServicesIcon from '@mui/icons-material/CleaningServices'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { getJobs, deleteJob, retryJob, clearJobs, type Job } from '../api'
import { tokens, sectionBox, pageHeaderSx } from '../theme'

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDuration(seconds: number | undefined): string {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fileName(fullPath: string): string {
  return fullPath.split('/').pop() || fullPath;
}

const statusColors: Record<string, 'success' | 'error' | 'warning' | 'info' | 'default'> = {
  completed: 'success',
  failed: 'error',
  skipped: 'warning',
  pending: 'info',
  checking: 'info',
  preflight: 'info',
  transcoding: 'info',
  replacing: 'info',
};

export default function JobsTable() {
  const queryClient = useQueryClient();

  // Each status group gets its own independent query — no limits, all rows returned
  const { data: completedJobs = [], isLoading: loadingCompleted } = useQuery({
    queryKey: ['jobs', 'completed'],
    queryFn: () => getJobs('completed'),
    refetchInterval: 10_000,
  });
  const { data: pendingJobs = [], isLoading: loadingPending } = useQuery({
    queryKey: ['jobs', 'active'],
    queryFn: () => getJobs('pending,checking,preflight,transcoding,replacing'),
    refetchInterval: 3_000,
  });
  const { data: failedJobs = [], isLoading: loadingFailed } = useQuery({
    queryKey: ['jobs', 'failed'],
    queryFn: () => getJobs('failed'),
    refetchInterval: 10_000,
  });
  const { data: skippedJobs = [], isLoading: loadingSkipped } = useQuery({
    queryKey: ['jobs', 'skipped'],
    queryFn: () => getJobs('skipped'),
    refetchInterval: 10_000,
  });

  const isLoading = loadingCompleted || loadingPending || loadingFailed || loadingSkipped;

  const deleteMut = useMutation({
    mutationFn: deleteJob,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['jobs'] }),
  });
  const retryMut = useMutation({
    mutationFn: retryJob,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['jobs'] }),
  });
  const clearMut = useMutation({
    mutationFn: clearJobs,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['jobs'] }),
  });

  const [clearAnchor, setClearAnchor] = useState<null | HTMLElement>(null);

  const columns = useMemo<MRT_ColumnDef<Job>[]>(() => [
    {
      accessorKey: 'id',
      header: 'ID',
      size: 60,
    },
    {
      accessorKey: 'sourcePath',
      header: 'File',
      Cell: ({ cell }) => (
        <Tooltip title={cell.getValue<string>()} arrow>
          <Typography variant="body2" noWrap sx={{ maxWidth: 300 }}>
            {fileName(cell.getValue<string>())}
          </Typography>
        </Tooltip>
      ),
      size: 300,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      size: 120,
      Cell: ({ cell }) => {
        const status = cell.getValue<string>();
        return (
          <Chip
            label={status}
            color={statusColors[status] || 'default'}
            size="small"
            variant="outlined"
          />
        );
      },
    },
    {
      accessorKey: 'profileName',
      header: 'Profile',
      size: 110,
    },
    {
      accessorKey: 'width',
      header: 'Resolution',
      size: 110,
      Cell: ({ row }) => {
        const w = row.original.width;
        const h = row.original.height;
        if (!w || !h) return '—';
        return `${w}×${h}`;
      },
    },
    {
      accessorKey: 'codec',
      header: 'Codec',
      size: 90,
    },
    {
      accessorKey: 'isHDR',
      header: 'HDR',
      size: 70,
      Cell: ({ cell }) => (cell.getValue() ? <Chip label="HDR" size="small" color="secondary" variant="outlined" /> : '—'),
    },
    {
      accessorKey: 'fileSize',
      header: 'Size',
      size: 90,
      Cell: ({ cell }) => formatBytes(cell.getValue<number>()),
    },
    {
      accessorKey: 'duration',
      header: 'Duration',
      size: 90,
      Cell: ({ cell }) => formatDuration(cell.getValue<number>()),
    },
    {
      accessorKey: 'createdAt',
      header: 'Created',
      size: 160,
      Cell: ({ cell }) => {
        const val = cell.getValue<string>();
        if (!val) return '—';
        return new Date(val).toLocaleString();
      },
    },
    {
      accessorKey: 'error',
      header: 'Error',
      size: 200,
      Cell: ({ cell }) => {
        const err = cell.getValue<string | null>();
        if (!err) return '—';
        return (
          <Tooltip title={err} arrow>
            <Typography variant="body2" color="error" noWrap sx={{ maxWidth: 200 }}>
              {err}
            </Typography>
          </Tooltip>
        );
      },
    },
  ], []);

  return (
    <Box sx={sectionBox}>
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" mb={3}>
        <Box>
          <Typography variant="h5" sx={pageHeaderSx}>
            Jobs
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Transcode queue and history
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            startIcon={<CleaningServicesIcon />}
            onClick={(e) => setClearAnchor(e.currentTarget)}
            variant="outlined"
            color="warning"
          >
            Clear
          </Button>
          <Menu
            anchorEl={clearAnchor}
            open={Boolean(clearAnchor)}
            onClose={() => setClearAnchor(null)}
          >
            <MenuItem onClick={() => { clearMut.mutate('completed'); setClearAnchor(null) }}>
              Clear Completed
            </MenuItem>
            <MenuItem onClick={() => { clearMut.mutate('failed'); setClearAnchor(null) }}>
              Clear Failed
            </MenuItem>
            <MenuItem onClick={() => { clearMut.mutate('skipped'); setClearAnchor(null) }}>
              Clear Skipped
            </MenuItem>
            <MenuItem onClick={() => { clearMut.mutate(undefined); setClearAnchor(null) }}>
              Clear All
            </MenuItem>
          </Menu>
        </Stack>
      </Stack>

      {/* Completed */}
      <StatusSection
        title="Completed"
        count={completedJobs.length}
        color="success"
        jobs={completedJobs}
        columns={columns}
        isLoading={isLoading}
        defaultExpanded
        renderRowActions={(row) => (
          <Tooltip title="Delete">
            <IconButton size="small" color="error" onClick={() => deleteMut.mutate(row.original.id)}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      />

      {/* Pending / Active */}
      <StatusSection
        title="Pending / Active"
        count={pendingJobs.length}
        color="info"
        jobs={pendingJobs}
        columns={columns}
        isLoading={isLoading}
        defaultExpanded
      />

      {/* Failed */}
      <StatusSection
        title="Failed"
        count={failedJobs.length}
        color="error"
        jobs={failedJobs}
        columns={columns}
        isLoading={isLoading}
        defaultExpanded
        visibleColumns={{ error: true }}
        renderRowActions={(row) => (
          <Stack direction="row" spacing={0.5}>
            <Tooltip title="Retry">
              <IconButton size="small" color="primary" onClick={() => retryMut.mutate(row.original.id)}>
                <ReplayIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete">
              <IconButton size="small" color="error" onClick={() => deleteMut.mutate(row.original.id)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        )}
      />

      {/* Skipped */}
      <StatusSection
        title="Skipped"
        count={skippedJobs.length}
        color="warning"
        jobs={skippedJobs}
        columns={columns}
        isLoading={isLoading}
        defaultExpanded={false}
        renderRowActions={(row) => (
          <Tooltip title="Delete">
            <IconButton size="small" color="error" onClick={() => deleteMut.mutate(row.original.id)}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      />
    </Box>
  );
}

// ─── Status Section Sub-Component ─────────────────────────────────────────────

interface StatusSectionProps {
  title: string;
  count: number;
  color: 'success' | 'error' | 'warning' | 'info';
  jobs: Job[];
  columns: MRT_ColumnDef<Job>[];
  isLoading: boolean;
  defaultExpanded?: boolean;
  visibleColumns?: Record<string, boolean>;
  renderRowActions?: (row: { original: Job }) => React.ReactNode;
}

function StatusSection({
  title,
  count,
  color,
  jobs,
  columns,
  isLoading,
  defaultExpanded = true,
  visibleColumns,
  renderRowActions,
}: StatusSectionProps) {
  const table = useMaterialReactTable({
    columns,
    data: jobs,
    enableRowActions: !!renderRowActions,
    positionActionsColumn: 'last',
    renderRowActions: renderRowActions ? ({ row }) => renderRowActions(row) : undefined,
    state: { isLoading },
    initialState: {
      sorting: [{ id: 'id', desc: true }],
      density: 'compact',
      columnVisibility: { error: false, status: false, ...visibleColumns },
    },
    enableColumnResizing: true,
    enableStickyHeader: true,
    enableRowVirtualization: true,
    enablePagination: false,
    enableTopToolbar: false,
    enableBottomToolbar: false,
    muiTablePaperProps: {
      sx: { border: 'none', boxShadow: 'none', background: 'transparent' },
    },
    muiTableContainerProps: { sx: { maxHeight: 500 } },
  });

  return (
    <Accordion defaultExpanded={defaultExpanded} sx={{ mb: 1.5 }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Typography fontWeight={600}>{title}</Typography>
          <Chip label={count} size="small" color={color} variant="outlined" />
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ p: 0 }}>
        <MaterialReactTable table={table} />
      </AccordionDetails>
    </Accordion>
  );
}
