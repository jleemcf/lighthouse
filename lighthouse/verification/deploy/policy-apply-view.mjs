export const title = 'Applying equal policy content preserves the running citation bytes';
export const state = v => [
  v.equal ? 'Same parsed policy' : 'Different parsed policy',
  v.phase === 'before apply' ? 'Before apply' : v.selected,
];
export const step = action => (action === 'Apply' ? 'apply the verified profile' : 'nothing changes');
