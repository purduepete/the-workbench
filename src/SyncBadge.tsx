import { CircleAlert, Cloud, CloudOff, CloudUpload, RefreshCw } from 'lucide-react';
import type { SyncStatus } from './useIdeasSync';

const severity: SyncStatus[] = ['synced', 'waiting', 'syncing', 'paused', 'offline'];

/** The header shows one badge for ideas and notes: the most serious status. */
export const worstStatus = (...statuses: SyncStatus[]): SyncStatus =>
    statuses.reduce((worst, status) => (severity.indexOf(status) > severity.indexOf(worst) ? status : worst));

export function SyncBadge({ status, waiting }: { status: SyncStatus; waiting: number }) {
    const pending = `${waiting} ${waiting === 1 ? 'change' : 'changes'} waiting`;
    const { icon: Icon, label } = {
        synced: { icon: Cloud, label: 'Synced' },
        syncing: { icon: RefreshCw, label: 'Syncing' },
        waiting: { icon: CloudUpload, label: pending },
        offline: { icon: CloudOff, label: waiting > 0 ? `Offline, ${pending}` : 'Offline' },
        paused: { icon: CircleAlert, label: waiting > 0 ? `Sync paused, ${pending}` : 'Sync paused' },
    }[status];
    return (
        <span className="local-badge" data-sync-status={status} role="status">
            <Icon size={14} aria-hidden="true" />
            {/* In the header, a healthy sync is just the cloud; anything needing attention spells itself out. */}
            <span className={status === 'synced' ? 'sr-only' : undefined}>{label}</span>
        </span>
    );
}
