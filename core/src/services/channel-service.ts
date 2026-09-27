import { IDatabaseService } from '../infrastructure/db-sqlite';
import { Channel, ChannelType, CHANNEL_TYPES } from '../entities/channel';
import { Heartbeat } from '../entities/heartbeat';
import { IChannelRepository, ChannelRepositoryFactory } from '../repositories/channel';

export interface DeliveryTarget {
  channel: ChannelType;
  target: string;
}

interface IChannelService {
  record(channel: string, target: string): void;
  setPrincipal(id: string): Channel | null;
  getPrincipal(): Channel | null;
  getByChannel(channel: ChannelType): Channel[];
  getAll(): Channel[];
  resolveDelivery(beat?: Heartbeat): DeliveryTarget | null;
}

function isRecordableChannel(channel: string): channel is ChannelType {
  return (CHANNEL_TYPES as readonly string[]).includes(channel);
}

class ChannelService implements IChannelService {
  constructor(private channelRepository: IChannelRepository) {}

  record(channel: string, target: string): void {
    if (!target || !isRecordableChannel(channel)) {
      return;
    }
    this.channelRepository.upsert(channel, target);
  }

  setPrincipal(id: string): Channel | null {
    return this.channelRepository.setPrincipal(id);
  }

  getPrincipal(): Channel | null {
    return this.channelRepository.getPrincipal();
  }

  getByChannel(channel: ChannelType): Channel[] {
    return this.channelRepository.getByChannel(channel);
  }

  getAll(): Channel[] {
    return this.channelRepository.getAll();
  }

  resolveDelivery(beat?: Heartbeat): DeliveryTarget | null {
    if (beat?.channel) {
      if (!isRecordableChannel(beat.channel)) {
        return null;
      }

      const target =
        beat.target || this.channelRepository.getByChannel(beat.channel)[0]?.target;

      if (target) {
        return { channel: beat.channel, target };
      }

      return null;
    }

    const principal = this.channelRepository.getPrincipal();
    if (!principal) {
      return null;
    }

    return { channel: principal.channel, target: principal.target };
  }
}

class ChannelServiceFactory {
  public static create(db: IDatabaseService): ChannelService {
    return new ChannelService(ChannelRepositoryFactory.create(db));
  }
}

export { IChannelService, ChannelService, ChannelServiceFactory };
