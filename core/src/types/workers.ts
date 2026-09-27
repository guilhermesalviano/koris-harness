export interface IWorker<TArgs = unknown, TResult = unknown> {
  name: string;
  run(args: TArgs): Promise<TResult>;
}
