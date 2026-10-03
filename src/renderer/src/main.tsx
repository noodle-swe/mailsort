import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IconContext } from '@phosphor-icons/react'
import '@fontsource-variable/geist'
import App from './App'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: {
    // Data is local (SQLite over IPC) and pushed via events, so no polling or focus refetch.
    queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: false }
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <IconContext.Provider value={{ size: 17, weight: 'regular' }}>
        <App />
      </IconContext.Provider>
    </QueryClientProvider>
  </StrictMode>
)
