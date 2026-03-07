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
import { getStats, pauseQueue, resumeQueue } from '../api'
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

export default function Dashboard() {
  const queryClient = useQueryClient()
  const { data: stats, isLoading } = useQuery({ queryKey: ['stats'], queryFn: getStats, refetchInterval: 3000 })

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
    </Box>
  )
}
