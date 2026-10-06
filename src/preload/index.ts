import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AppEvent, MailApi } from './api'

const invoke =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args)

const api: MailApi = {
  status: invoke('status') as MailApi['status'],
  listMessages: invoke('messages:list') as MailApi['listMessages'],
  getMessage: invoke('messages:get') as MailApi['getMessage'],
  getBody: invoke('messages:body') as MailApi['getBody'],
  markRead: invoke('messages:markRead') as MailApi['markRead'],
  setRead: invoke('messages:setRead') as MailApi['setRead'],
  digest: invoke('digest:get') as MailApi['digest'],
  setTag: invoke('tags:set') as MailApi['setTag'],
  tagCounts: invoke('tags:counts') as MailApi['tagCounts'],
  unreadCounts: invoke('messages:unread') as MailApi['unreadCounts'],
  listAccounts: invoke('accounts:list') as MailApi['listAccounts'],
  addAccount: invoke('accounts:add') as MailApi['addAccount'],
  cancelAddAccount: invoke('accounts:cancelAdd') as MailApi['cancelAddAccount'],
  removeAccount: invoke('accounts:remove') as MailApi['removeAccount'],
  syncNow: invoke('accounts:sync') as MailApi['syncNow'],
  runTagging: invoke('tags:run') as MailApi['runTagging'],
  getSettings: invoke('settings:get') as MailApi['getSettings'],
  updateSettings: invoke('settings:update') as MailApi['updateSettings'],
  checkOllama: invoke('ollama:check') as MailApi['checkOllama'],
  startOllama: invoke('ollama:start') as MailApi['startOllama'],
  pullModel: invoke('ollama:pull') as MailApi['pullModel'],
  cancelPull: invoke('ollama:cancelPull') as MailApi['cancelPull'],
  pullStatus: invoke('ollama:pulls') as MailApi['pullStatus'],
  storageStats: invoke('storage:stats') as MailApi['storageStats'],
  clearCache: invoke('storage:clear') as MailApi['clearCache'],
  chat: invoke('chat:send') as MailApi['chat'],
  cancelChat: invoke('chat:cancel') as MailApi['cancelChat'],
  openExternal: invoke('shell:open') as MailApi['openExternal'],
  openLogFolder: invoke('log:open') as MailApi['openLogFolder'],
  copyLog: invoke('log:copy') as MailApi['copyLog'],
  onEvent(listener) {
    const handler = (_: IpcRendererEvent, event: AppEvent) => listener(event)
    ipcRenderer.on('app:event', handler)
    return () => ipcRenderer.removeListener('app:event', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
