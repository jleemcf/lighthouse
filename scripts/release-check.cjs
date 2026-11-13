'use strict';
// Release-only: four full newcomer workflows. The per-commit runner never invokes this command.
delete process.env.TYPESAFE_API_KEY;
require('./check-clean-room.cjs')
  .run()
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
