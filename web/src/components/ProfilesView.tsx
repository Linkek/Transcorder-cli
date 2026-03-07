import { useQuery } from '@tanstack/react-query'
import {
  Box,
  Typography,
  Card,
  CardContent,
  Chip,
  Stack,
  Divider,
  LinearProgress,
} from '@mui/material'
import Grid from '@mui/material/Grid2'
import FolderIcon from '@mui/icons-material/Folder'
import { getProfiles, type Profile } from '../api'
import { tokens, sectionBox, pageHeaderSx } from '../theme'

function ProfileCard({ profile }: { profile: Profile }) {
  return (
    <Card sx={{ bgcolor: tokens.bgSurface }}>
      <CardContent sx={{ p: 2.5 }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
          <Typography variant="h6" sx={{ mb: 0, fontWeight: 600 }}>{profile.name}</Typography>
          <Chip
            label={`Priority ${profile.priority}`}
            size="small"
            variant="outlined"
            sx={{ borderColor: tokens.borderColorLight }}
          />
        </Box>

        <Divider sx={{ mb: 2 }} />

        <Grid container spacing={2}>
          <Grid size={{ xs: 12 }}>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.7rem' }}>
              Source Folders
            </Typography>
            <Stack spacing={0.5} mt={0.5}>
              {profile.sourceFolders.map((f, i) => (
                <Stack key={i} direction="row" spacing={0.5} alignItems="center">
                  <FolderIcon fontSize="small" sx={{ color: tokens.primary, fontSize: 16 }} />
                  <Typography variant="body2" noWrap sx={{ color: tokens.textPrimary }}>{f}</Typography>
                </Stack>
              ))}
            </Stack>
          </Grid>

          <Grid size={{ xs: 6, sm: 3 }}>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.7rem' }}>
              Max Resolution
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>{profile.maxWidth}×{profile.maxHeight}</Typography>
          </Grid>

          <Grid size={{ xs: 6, sm: 3 }}>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.7rem' }}>
              Output Format
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>.{profile.outputFormat}</Typography>
          </Grid>

          <Grid size={{ xs: 6, sm: 3 }}>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.7rem' }}>
              NVENC Preset
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>{profile.nvencPreset}</Typography>
          </Grid>

          <Grid size={{ xs: 6, sm: 3 }}>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.7rem' }}>
              CQ Value
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>{profile.cqValue}</Typography>
          </Grid>

          <Grid size={{ xs: 6, sm: 3 }}>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.7rem' }}>
              Min Size Reduction
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>{profile.minSizeReduction}%</Typography>
          </Grid>

          <Grid size={{ xs: 12 }}>
            <Stack direction="row" spacing={1} mt={1} flexWrap="wrap" useFlexGap>
              {profile.recursive && <Chip label="Recursive" size="small" variant="outlined" />}
              {profile.replaceFile && <Chip label="Replace Original" size="small" color="error" variant="outlined" />}
              {profile.downscaleToMax && <Chip label="Downscale" size="small" color="info" variant="outlined" />}
              {profile.renameFiles && <Chip label="Rename Files" size="small" variant="outlined" />}
              {profile.removeHDR && <Chip label="Remove HDR" size="small" color="secondary" variant="outlined" />}
              {profile.log && <Chip label="Logging" size="small" variant="outlined" />}
            </Stack>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  )
}

export default function ProfilesView() {
  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ['profiles'],
    queryFn: getProfiles,
    refetchInterval: 30000,
  })

  return (
    <Box sx={sectionBox}>
      {/* Header */}
      <Box mb={3}>
        <Typography variant="h5" sx={pageHeaderSx}>
          Profiles
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Transcoding profile configurations
        </Typography>
      </Box>

      {isLoading && <LinearProgress sx={{ borderRadius: 1, mb: 2 }} />}

      <Stack spacing={tokens.gridSpacing}>
        {profiles.map((p) => (
          <ProfileCard key={p.name} profile={p} />
        ))}
      </Stack>

      {!isLoading && profiles.length === 0 && (
        <Typography color="text.secondary" textAlign="center" py={4}>
          No profiles configured
        </Typography>
      )}
    </Box>
  )
}
