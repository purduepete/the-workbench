export type ThemePreference = 'system' | 'light' | 'midnight';
export type IdeaView = 'all' | 'pinned' | 'archived';

export interface Idea {
    id: string;
    title: string;
    body: string;
    tags: string[];
    createdAt: string;
    updatedAt: string;
    pinned: boolean;
    archived: boolean;
}
