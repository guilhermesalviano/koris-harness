import type { ProcessedMessage, ProcessOptions } from '../../../plugins/channels/contracts';

export type { ProcessedMessage, ProcessOptions };

export interface IAgent<TInput, TOutput> {
  run(input: TInput): Promise<TOutput>;
}

export interface ISubAgent<TInput = unknown> {
  handler(props: TInput): Promise<void>;
}
