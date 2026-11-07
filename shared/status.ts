export const ideaStatuses = ['n/a', 'open', 'in-progress', 'done'] as const;
export type IdeaStatus = (typeof ideaStatuses)[number];

export const ideaPriorities = ['high', 'medium', 'low'] as const;
export type IdeaPriority = (typeof ideaPriorities)[number];
export const defaultPriority: IdeaPriority = 'high';

export function statusForSolution(solution: string | null, status: IdeaStatus = 'open'): IdeaStatus {
    return solution === null ? 'n/a' : status === 'n/a' ? 'open' : status;
}
