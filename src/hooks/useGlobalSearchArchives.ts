import { useQuery } from '@tanstack/react-query'

import type { SignedRoomArchive } from '../lib/appShellSchemas'
import { desktopStorageClient } from '../lib/desktopStorageClient'
import { isTauriEnvironment } from '../lib/tauriEnv'

export function useGlobalSearchArchives(refreshToken = 0) {
  return useQuery<SignedRoomArchive[]>({
    queryKey: ['global-search-archives', refreshToken],
    queryFn: async () => {
      if (!isTauriEnvironment()) {
        return []
      }

      return desktopStorageClient.loadAllRoomArchives()
    },
    staleTime: 30_000,
  })
}
