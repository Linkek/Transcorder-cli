import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Box,
  Typography,
  IconButton,
  Chip,
  Tooltip,
  FormControlLabel,
  Switch,
} from '@mui/material'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep'
import VerticalAlignBottomIcon from '@mui/icons-material/VerticalAlignBottom'
import { tokens, sectionBox } from '../theme'
import type { LogEntry } from '../api'

const LEVEL_COLORS: Record<string, string> = {
  debug: tokens.textMuted,
  info: tokens.info,
  warn: tokens.warning,
  error: tokens.error,
  success: tokens.success,
}

const LEVEL_LABELS: Record<string, string> = {
  debug: 'DBG',
  info: 'INF',
  warn: 'WRN',
  error: 'ERR',
  success: 'OK',
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-GB', { hour12: false }) +
    '.' + String(d.getMilliseconds()).padStart(3, '0')
}

export default function LogsView() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [autoScroll, setAutoScroll] = useState(true)
  const [showDebug, setShowDebug] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)

  // SSE connection for real-time log streaming
  useEffect(() => {
    const eventSource = new EventSource('/api/logs/stream')

    eventSource.onmessage = (event) => {
      try {
        const entry: LogEntry = JSON.parse(event.data)
        setEntries(prev => {
          // Deduplicate by id
          if (prev.length > 0 && prev[prev.length - 1].id >= entry.id) {
            return prev
          }
          const updated = [...prev, entry]
          // Keep max 2000 entries in the UI
          if (updated.length > 2000) {
            return updated.slice(-1500)
          }
          return updated
        })
      } catch { /* ignore parse errors */ }
    }

    eventSource.onerror = () => {
      // EventSource will auto-reconnect
    }

    return () => {
      eventSource.close()
    }
  }, [])

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (autoScroll && isAtBottomRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [entries, autoScroll])

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 40
  }, [])

  const scrollToBottom = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
      isAtBottomRef.current = true
    }
  }, [])

  const clearLogs = useCallback(() => {
    setEntries([])
  }, [])

  const filtered = showDebug ? entries : entries.filter(e => e.level !== 'debug')

  return (
    <Box sx={{ ...sectionBox, p: 0, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 140px)' }}>
      {/* Toolbar */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 2,
          py: 1,
          borderBottom: `1px solid ${tokens.borderColor}`,
          flexShrink: 0,
        }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mr: 'auto' }}>
          Live Logs
        </Typography>

        <Chip
          label={`${filtered.length} entries`}
          size="small"
          variant="outlined"
          sx={{ borderColor: tokens.borderColorLight, color: tokens.textMuted, fontSize: '0.7rem' }}
        />

        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={showDebug}
              onChange={(_, v) => setShowDebug(v)}
              sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: tokens.primary } }}
            />
          }
          label={<Typography variant="caption" sx={{ color: tokens.textMuted }}>Debug</Typography>}
          sx={{ m: 0 }}
        />

        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={autoScroll}
              onChange={(_, v) => setAutoScroll(v)}
              sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: tokens.primary } }}
            />
          }
          label={<Typography variant="caption" sx={{ color: tokens.textMuted }}>Auto-scroll</Typography>}
          sx={{ m: 0 }}
        />

        <Tooltip title="Scroll to bottom">
          <IconButton size="small" onClick={scrollToBottom} sx={{ color: tokens.textMuted }}>
            <VerticalAlignBottomIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Tooltip title="Clear log view">
          <IconButton size="small" onClick={clearLogs} sx={{ color: tokens.textMuted }}>
            <DeleteSweepIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Log entries */}
      <Box
        ref={containerRef}
        onScroll={handleScroll}
        sx={{
          flex: 1,
          overflow: 'auto',
          fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
          fontSize: '0.78rem',
          lineHeight: 1.7,
          px: 2,
          py: 1,
          scrollbarWidth: 'thin',
          scrollbarColor: `${tokens.borderColorLight} transparent`,
        }}
      >
        {filtered.length === 0 ? (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Typography variant="body2" sx={{ color: tokens.textMuted }}>
              Waiting for log entries...
            </Typography>
          </Box>
        ) : (
          filtered.map(entry => (
            <Box
              key={entry.id}
              sx={{
                display: 'flex',
                gap: 1,
                py: 0.15,
                '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.02)' },
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              <Box
                component="span"
                sx={{ color: tokens.textMuted, flexShrink: 0, userSelect: 'none' }}
              >
                {formatTimestamp(entry.timestamp)}
              </Box>
              <Box
                component="span"
                sx={{
                  color: LEVEL_COLORS[entry.level] || tokens.textMuted,
                  fontWeight: 600,
                  flexShrink: 0,
                  minWidth: '2.5em',
                  userSelect: 'none',
                }}
              >
                [{LEVEL_LABELS[entry.level] || entry.level.toUpperCase()}]
              </Box>
              <Box
                component="span"
                sx={{
                  color: entry.level === 'error' ? tokens.error
                    : entry.level === 'warn' ? tokens.warning
                    : tokens.textPrimary,
                  flex: 1,
                }}
              >
                {entry.message}
              </Box>
            </Box>
          ))
        )}
      </Box>
    </Box>
  )
}
