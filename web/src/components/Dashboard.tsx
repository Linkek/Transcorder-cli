import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Stack,
  Chip,
  LinearProgress,
} from '@mui/material'
import Grid from '@mui/material/Grid2'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import SkipNextIcon from '@mui/icons-material/SkipNext'
import PendingIcon from '@mui/icons-material/Pending'
import SavingsIcon from '@mui/icons-material/Savings'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import PauseIcon from '@mui/icons-material/Pause'
import StorageIcon from '@mui/icons-material/Storage'
import SpeedIcon from '@mui/icons-material/Speed'
import MemoryIcon from '@mui/icons-material/Memory'
import HdrAutoIcon from '@mui/icons-material/HdrAuto'
import { getStats, getWorkers, pauseQueue, resumeQueue } from '../api'
import type { WorkerState } from '../api'
import { tokens, sectionBox, pageHeaderSx } from '../theme'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

interface StatCardProps {
  title: string
  value: string | number
  icon: React.ReactNode
  color: string
  subtitle?: string
}

function StatCard({ title, value, icon, color, subtitle }: StatCardProps) {
  return (
    <Card
      sx={{
        height: '100%',
        bgcolor: tokens.bgSurface,
        position: 'relative',
        overflow: 'hidden',
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: color,
          opacity: 0.7,
        },
      }}
    >
      <CardContent sx={{ p: 2.5 }}>
        <Box display="flex" justifyContent="space-between" alignItems="flex-start">
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', mb: 0.5 }}>
              {title}
            </Typography>
            <Typography variant="h4" fontWeight={700} sx={{ color, m: 0, lineHeight: 1.2 }}>
              {value}
            </Typography>
            {subtitle && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                {subtitle}
              </Typography>
            )}
          </Box>
          <Box
            sx={{
              color,
              opacity: 0.3,
              mt: 0.5,
              fontSize: 36,
              display: 'flex',
            }}
          >
            {icon}
          </Box>
        </Box>
      </CardContent>
    </Card>
  )
}

function WorkerCard({ worker }: { worker: WorkerState }) {
  const percent = worker.progress?.percent ?? 0
  const isActive = !worker.idle && worker.fileName

  return (
    <Card
      sx={{
        bgcolor: tokens.bgSurface,
        position: 'relative',
        overflow: 'hidden',
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: isActive ? tokens.primary : tokens.borderColorLight,
          opacity: isActive ? 0.7 : 0.3,
        },
      }}
    >
      <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={isActive ? 1.5 : 0}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Box sx={{ color: isActive ? tokens.primary : tokens.textMuted, opacity: isActive ? 1 : 0.4, display: 'flex' }}>
              <MemoryIcon fontSize="small" />
            </Box>
            <Typography variant="body2" fontWeight={600} sx={{ color: isActive ? tokens.textPrimary : tokens.textMuted }}>
              Worker {worker.slot + 1}
            </Typography>
            {isActive && worker.hdr && (
              <Chip
                icon={<HdrAutoIcon />}
                label={worker.removeHDR ? 'HDR→SDR' : 'HDR'}
                size="small"
                sx={{
                  height: 20,
                  fontSize: '0.65rem',
                  bgcolor: worker.removeHDR ? 'rgba(255, 167, 38, 0.15)' : 'rgba(0, 229, 255, 0.15)',
                  color: worker.removeHDR ? tokens.warning : tokens.secondary,
                  '& .MuiChip-icon': { fontSize: 14, color: 'inherit' },
                }}
              />
            )}
          </Stack>
          {isActive ? (
            <Chip
              label="Active"
              size="small"
              sx={{
                height: 20,
                fontSize: '0.65rem',
                fontWeight: 600,
                bgcolor: 'rgba(124, 77, 255, 0.15)',
                color: tokens.primary,
              }}
            />
          ) : (
            <Chip
              label="Idle"
              size="small"
              sx={{
                height: 20,
                fontSize: '0.65rem',
                fontWeight: 600,
                bgcolor: 'rgba(148, 163, 184, 0.1)',
                color: tokens.textMuted,
              }}
            />
          )}
        </Box>

        {isActive && (
          <>
            <Typography
              variant="body2"
              sx={{
                color: tokens.textPrimary,
                fontSize: '0.8rem',
                mb: 0.5,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {worker.fileName}
            </Typography>

            <Typography variant="caption" sx={{ color: tokens.textMuted, display: 'block', mb: 1.5 }}>
              {worker.srcRes} → {worker.targetRes}
            </Typography>

            <Box sx={{ mb: 1 }}>
              <LinearProgress
                variant="determinate"
                value={percent}
                sx={{
                  height: 6,
                  borderRadius: 3,
                  bgcolor: 'rgba(124, 77, 255, 0.1)',
                  '& .MuiLinearProgress-bar': {
                    borderRadius: 3,
                    background: `linear-gradient(90deg, ${tokens.primaryDark}, ${tokens.primary})`,
                  },
                }}
              />
            </Box>

            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Typography variant="caption" sx={{ color: tokens.primary, fontWeight: 600 }}>
                {Math.round(percent)}%
              </Typography>
              <Stack direction="row" spacing={1.5}>
                {worker.progress && worker.progress.fps > 0 && (
                  <Typography variant="caption" sx={{ color: tokens.textMuted }}>
                    {worker.progress.fps.toFixed(0)} fps
                  </Typography>
                )}
                {worker.progress && worker.progress.speed > 0 && (
                  <Typography variant="caption" sx={{ color: tokens.textMuted }}>
                    {worker.progress.speed.toFixed(1)}x
                  </Typography>
                )}
                {worker.progress && worker.progress.eta > 0 && (
                  <Typography variant="caption" sx={{ color: tokens.textMuted }}>
                    ETA {formatEta(worker.progress.eta)}
                  </Typography>
                )}
              </Stack>
            </Box>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}m ${s}s`
}

export default function Dashboard() {
  const queryClient = useQueryClient()
  const { data: stats, isLoading } = useQuery({ queryKey: ['stats'], queryFn: getStats, refetchInterval: 3000 })
  const { data: workers } = useQuery({ queryKey: ['workers'], queryFn: getWorkers, refetchInterval: 1000 })

  const pauseMut = useMutation({
    mutationFn: pauseQueue,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['stats'] }),
  })
  const resumeMut = useMutation({
    mutationFn: resumeQueue,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['stats'] }),
  })

  if (isLoading || !stats) {
    return (
      <Box sx={sectionBox}>
        <LinearProgress sx={{ borderRadius: 1 }} />
      </Box>
    )
  }

  return (
    <Box sx={sectionBox}>
      {/* Header */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Typography variant="h5" sx={pageHeaderSx}>
            Dashboard
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Transcoding queue overview and controls
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip
            label={stats.paused ? 'Paused' : 'Running'}
            color={stats.paused ? 'warning' : 'success'}
            size="small"
            sx={{ fontWeight: 600 }}
          />
          {stats.paused ? (
            <Button
              variant="contained"
              color="success"
              size="small"
              startIcon={<PlayArrowIcon />}
              onClick={() => resumeMut.mutate()}
              disabled={resumeMut.isPending}
            >
              Resume
            </Button>
          ) : (
            <Button
              variant="outlined"
              color="warning"
              size="small"
              startIcon={<PauseIcon />}
              onClick={() => pauseMut.mutate()}
              disabled={pauseMut.isPending}
            >
              Pause
            </Button>
          )}
        </Stack>
      </Box>

      {/* Stat Cards */}
      <Grid container spacing={tokens.gridSpacing}>
        <Grid size={{ xs: 6, sm: 4, md: 3 }}>
          <StatCard
            title="Completed"
            value={stats.completed}
            icon={<CheckCircleIcon fontSize="inherit" />}
            color={tokens.success}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 4, md: 3 }}>
          <StatCard
            title="Failed"
            value={stats.failed}
            icon={<ErrorIcon fontSize="inherit" />}
            color={tokens.error}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 4, md: 3 }}>
          <StatCard
            title="Skipped"
            value={stats.skipped}
            icon={<SkipNextIcon fontSize="inherit" />}
            color={tokens.warning}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 4, md: 3 }}>
          <StatCard
            title="Space Saved"
            value={formatBytes(stats.savedBytes)}
            icon={<SavingsIcon fontSize="inherit" />}
            color={tokens.secondary}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 4, md: 3 }}>
          <StatCard
            title="Active Workers"
            value={stats.active}
            icon={<SpeedIcon fontSize="inherit" />}
            color={tokens.primary}
            subtitle="GPU encoding slots"
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 4, md: 3 }}>
          <StatCard
            title="Pending"
            value={stats.pending}
            icon={<PendingIcon fontSize="inherit" />}
            color={tokens.info}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 4, md: 3 }}>
          <StatCard
            title="Total Jobs"
            value={stats.total}
            icon={<StorageIcon fontSize="inherit" />}
            color={tokens.textMuted}
          />
        </Grid>
      </Grid>

      {/* Worker Cards */}
      {workers && workers.length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Typography variant="subtitle2" sx={{ color: tokens.textMuted, mb: 1.5, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.75rem' }}>
            Workers
          </Typography>
          <Grid container spacing={tokens.gridSpacing}>
            {workers.map((w) => (
              <Grid key={w.slot} size={{ xs: 12, md: 6 }}>
                <WorkerCard worker={w} />
              </Grid>
            ))}
          </Grid>
        </Box>
      )}
    </Box>
  )
}
