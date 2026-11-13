export const title = 'Migrate offline, deploy compatible code, retain newer work';
export const state = value =>
  value.schema === 2 && !value.backup
    ? 'Schema marked without a backup'
    : value.runningSchema === 1 && value.schema === 2
      ? 'Old code running on migrated data'
      : value.work < value.retainedWork
        ? 'Newer work overwritten by the old backup'
        : value.phase;
export const step = (action, from, to) =>
  ({
    Backup: 'a full private backup finishes',
    PrepareRollback: 'a schema-2 fallback build is retained',
    ImportRegistry: 'the private registry is imported',
    MarkSchema: 'the host explicitly marks schema 2',
    Deploy: 'the host deploys a schema-2 release',
    NewWork: 'newer board work is saved',
    Rollback:
      to.work < to.retainedWork
        ? 'the pre-migration backup overwrites newer work'
        : to.runningSchema < to.schema
          ? 'an incompatible old release is selected'
          : 'only compatible code is selected; data stays current',
    Done: 'nothing changes',
  })[action] || action;
