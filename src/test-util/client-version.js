import pkg from '../../package.json';

/** Matches the value Rollup injects for __VERSION__ in test/production bundles. */
export const clientVersion = pkg.version;
