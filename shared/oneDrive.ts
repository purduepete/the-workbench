import { z } from 'zod';

export const oneDriveConfigSchema = z.object({
    clientId: z.uuid(),
    baseUrl: z.string().url(),
    tenantId: z.union([z.literal('consumers'), z.uuid()]),
});
export type OneDriveConfig = z.infer<typeof oneDriveConfigSchema>;

export function oneDriveConfig(environment: Record<string, string | undefined>): OneDriveConfig | null {
    if (!environment.ONEDRIVE_CLIENT_ID) return null;
    const config = oneDriveConfigSchema.parse({
        clientId: environment.ONEDRIVE_CLIENT_ID,
        baseUrl: environment.ONEDRIVE_BASE_URL ?? 'https://onedrive.live.com/picker',
        tenantId: environment.ONEDRIVE_TENANT_ID ?? 'consumers',
    });
    const url = new URL(config.baseUrl);
    const personal = config.baseUrl === 'https://onedrive.live.com/picker';
    const business =
        url.protocol === 'https:' &&
        !url.port &&
        url.hostname.endsWith('.sharepoint.com') &&
        url.origin === config.baseUrl &&
        config.tenantId !== 'consumers';
    if (!personal && !business) throw new Error('Configure a OneDrive consumer picker or a SharePoint HTTPS origin.');
    if (personal && config.tenantId !== 'consumers')
        throw new Error('Personal OneDrive requires ONEDRIVE_TENANT_ID=consumers.');
    return config;
}
