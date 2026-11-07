import type { IdeaPriority, IdeaStatus } from '../shared/contracts';

export type ThemePreference = 'system' | 'light' | 'midnight';
export type IdeaView = 'all' | 'pinned' | 'archived';
export type { IdeaPriority, IdeaStatus };

export interface Idea {
    id: string;
    title: string;
    body: string;
    tags: string[];
    createdAt: string;
    updatedAt: string;
    pinned: boolean;
    archived: boolean;
    /** Solution Directory id this idea is for, or null. */
    solution: string | null;
    status: IdeaStatus;
    priority: IdeaPriority;
}
