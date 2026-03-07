import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Box, CircularProgress } from '@mui/material';
import { getAuthStatus } from './api';
import Login from './components/Login';
import Layout from './components/Layout';

export default function App() {
  const { data: auth, isLoading, refetch } = useQuery({
    queryKey: ['auth'],
    queryFn: getAuthStatus,
    retry: false,
    refetchInterval: false,
  });

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
        <CircularProgress />
      </Box>
    );
  }

  if (!auth?.authenticated) {
    return <Login onLogin={() => refetch()} />;
  }

  return <Layout username={auth.username || 'user'} onLogout={() => refetch()} />;
}
