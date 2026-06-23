import { readFile } from 'fs/promises';
import { join } from 'path';

const LOCAL_POOLER_URL_PATH = join(import.meta.dir, '../../supabase/.temp/pooler-url');

export interface ResolvedDatabaseConnection {
  connectionString: string;
  source: 'explicit' | 'environment-pooler' | 'linked-project-pooler' | 'direct-fallback';
}

const getProjectRefFromSupabaseUrl = (value: string | undefined) => {
  if (!value) return null;

  try {
    return new URL(value).hostname.split('.')[0] || null;
  } catch {
    return null;
  }
};

const getDirectProjectRef = (connectionString: string) => {
  try {
    const hostname = new URL(connectionString).hostname;
    const canonicalMatch = hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
    if (canonicalMatch) return canonicalMatch[1];

    const legacyMatch = hostname.match(/^([a-z0-9]+)\.db\.supabase\.co$/i);
    return legacyMatch?.[1] ?? null;
  } catch {
    return null;
  }
};

const getPoolerProjectRef = (connectionString: string) => {
  try {
    const username = decodeURIComponent(new URL(connectionString).username);
    const match = username.match(/^postgres\.([a-z0-9]+)$/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
};

const readLinkedProjectPoolerUrl = async () => {
  try {
    return (await readFile(LOCAL_POOLER_URL_PATH, 'utf8')).trim();
  } catch {
    return null;
  }
};

const applyCredentials = (
  poolerConnectionString: string,
  sourceConnectionString?: string
) => {
  const poolerUrl = new URL(poolerConnectionString);
  const sourceUrl = sourceConnectionString ? new URL(sourceConnectionString) : null;
  const password = sourceUrl?.password || process.env.SUPABASE_PASSWORD || '';

  if (password) poolerUrl.password = password;
  if (sourceUrl?.pathname && sourceUrl.pathname !== '/') {
    poolerUrl.pathname = sourceUrl.pathname;
  }

  return poolerUrl.toString();
};

const resolveCompatiblePooler = async (
  sourceConnectionString: string,
  expectedProjectRef: string
) => {
  const environmentPoolerUrl = process.env.SUPABASE_POOLER_URL;
  if (environmentPoolerUrl) {
    const poolerProjectRef = getPoolerProjectRef(environmentPoolerUrl);
    if (!poolerProjectRef || poolerProjectRef === expectedProjectRef) {
      return {
        connectionString: applyCredentials(environmentPoolerUrl, sourceConnectionString),
        source: 'environment-pooler' as const
      };
    }
  }

  const linkedProjectPoolerUrl = await readLinkedProjectPoolerUrl();
  if (!linkedProjectPoolerUrl) return null;

  const poolerProjectRef = getPoolerProjectRef(linkedProjectPoolerUrl);
  if (poolerProjectRef !== expectedProjectRef) return null;

  return {
    connectionString: applyCredentials(linkedProjectPoolerUrl, sourceConnectionString),
    source: 'linked-project-pooler' as const
  };
};

export const resolveDatabaseConnection = async (): Promise<ResolvedDatabaseConnection> => {
  const explicitConnectionString =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.SUPABASE_DB_URL;

  if (explicitConnectionString) {
    const directProjectRef = getDirectProjectRef(explicitConnectionString);

    // Supabase direct database hosts commonly expose IPv6 only. For local
    // IPv4 networks, transparently use the pooler metadata from the linked
    // Supabase project while preserving the configured database credentials.
    if (directProjectRef) {
      const pooler = await resolveCompatiblePooler(
        explicitConnectionString,
        directProjectRef
      );
      if (pooler) return pooler;
    }

    return {
      connectionString: explicitConnectionString,
      source: 'explicit'
    };
  }

  if (process.env.SUPABASE_POOLER_URL) {
    return {
      connectionString: applyCredentials(process.env.SUPABASE_POOLER_URL),
      source: 'environment-pooler'
    };
  }

  const supabaseUrl = process.env.SUPABASE_URL || '';
  const projectRef = getProjectRefFromSupabaseUrl(supabaseUrl);
  const database = process.env.SUPABASE_DATABASE || 'postgres';
  const password = process.env.SUPABASE_PASSWORD || '';

  if (!projectRef) {
    throw new Error(
      'DATABASE_URL atau SUPABASE_URL yang valid wajib diset untuk menjalankan migration.'
    );
  }

  const directUrl = new URL(
    `postgresql://postgres@db.${projectRef}.supabase.co:5432/${database}`
  );
  directUrl.password = password;

  const pooler = await resolveCompatiblePooler(directUrl.toString(), projectRef);
  if (pooler) return pooler;

  return {
    connectionString: directUrl.toString(),
    source: 'direct-fallback'
  };
};

export const maskDatabaseConnectionString = (connectionString: string) => {
  try {
    const url = new URL(connectionString);
    const username = decodeURIComponent(url.username);
    return `${url.protocol}//${username}:****@${url.host}${url.pathname}`;
  } catch {
    return '[invalid database connection string]';
  }
};
