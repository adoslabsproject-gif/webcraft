/// Type shim — ioredis-mock ships no type declarations. The mock mirrors
/// ioredis: every redis command is an instance method returning a promise;
/// redis-driver dispatches commands dynamically, so an index signature is
/// the honest shape here.
declare module 'ioredis-mock' {
  class RedisMock {
    [command: string]: (...args: Array<string | number>) => Promise<unknown> | unknown;
  }
  export default RedisMock;
}
