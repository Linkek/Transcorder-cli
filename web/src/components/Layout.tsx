import { useState } from 'react'
import {
  Box,
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Tabs,
  Tab,
  Chip,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import LogoutIcon from '@mui/icons-material/Logout'
import DashboardIcon from '@mui/icons-material/Dashboard'
import ListAltIcon from '@mui/icons-material/ListAlt'
import TuneIcon from '@mui/icons-material/Tune'
import Dashboard from './Dashboard'
import JobsTable from './JobsTable'
import ProfilesView from './ProfilesView'
import { logout } from '../api'
import { tokens } from '../theme'

interface LayoutProps {
  username: string
  onLogout: () => void
}

export default function Layout({ username, onLogout }: LayoutProps) {
  const [tab, setTab] = useState(0)
  const muiTheme = useTheme()
  const isMobile = useMediaQuery(muiTheme.breakpoints.down('sm'))

  const handleLogout = async () => {
    await logout()
    onLogout()
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: tokens.bgGradient }}>
      <AppBar
        position="sticky"
        elevation={0}
        sx={{
          bgcolor: 'rgba(17, 24, 39, 0.85)',
          backdropFilter: 'blur(12px)',
          borderBottom: `1px solid ${tokens.borderColor}`,
        }}
      >
        <Toolbar sx={{ gap: 1 }}>
          <Typography
            variant="h6"
            sx={{
              background: `linear-gradient(135deg, ${tokens.primary}, ${tokens.secondary})`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              fontWeight: 800,
              letterSpacing: '-0.03em',
              mr: 1,
              fontSize: { xs: '1rem', sm: '1.25rem' },
            }}
          >
            Transcorder
          </Typography>

          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            sx={{ flexGrow: 1, ml: { xs: 0, sm: 2 } }}
            textColor="inherit"
            TabIndicatorProps={{
              sx: {
                bgcolor: tokens.primary,
                height: 3,
                borderRadius: '3px 3px 0 0',
              },
            }}
          >
            <Tab
              icon={<DashboardIcon fontSize="small" />}
              iconPosition="start"
              label={isMobile ? undefined : 'Dashboard'}
              sx={{ minWidth: isMobile ? 48 : undefined }}
            />
            <Tab
              icon={<ListAltIcon fontSize="small" />}
              iconPosition="start"
              label={isMobile ? undefined : 'Jobs'}
              sx={{ minWidth: isMobile ? 48 : undefined }}
            />
            <Tab
              icon={<TuneIcon fontSize="small" />}
              iconPosition="start"
              label={isMobile ? undefined : 'Profiles'}
              sx={{ minWidth: isMobile ? 48 : undefined }}
            />
          </Tabs>

          {!isMobile && (
            <Chip
              label={username}
              size="small"
              variant="outlined"
              sx={{
                borderColor: tokens.borderColorLight,
                color: tokens.textMuted,
                fontSize: '0.75rem',
              }}
            />
          )}
          <IconButton onClick={handleLogout} size="small" color="inherit" title="Logout">
            <LogoutIcon fontSize="small" />
          </IconButton>
        </Toolbar>
      </AppBar>

      <Box
        sx={{
          flex: 1,
          p: { xs: 2, sm: 3 },
          maxWidth: 1400,
          mx: 'auto',
          width: '100%',
        }}
      >
        <Box sx={{ display: tab === 0 ? 'block' : 'none' }}>
          <Dashboard />
        </Box>
        <Box sx={{ display: tab === 1 ? 'block' : 'none' }}>
          <JobsTable />
        </Box>
        <Box sx={{ display: tab === 2 ? 'block' : 'none' }}>
          <ProfilesView />
        </Box>
      </Box>
    </Box>
  )
}
