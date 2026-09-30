import type { Request, Response, Router } from 'express';
import type { IChannelRepository } from '../../repositories/channel';
import type { IOutboundMessageRepository } from '../../repositories/outbound-message';
import type { IOutboundMessageService } from '../../services/outbound/message-service';
import { CHANNEL_TYPES, type ChannelType } from '../../entities/channel';

export interface ChannelsRouteDependencies {
  channelRepo: Pick<IChannelRepository, 'getAll' | 'setPrincipal'>;
  outboundRepo: Pick<IOutboundMessageRepository, 'getAll'>;
  getOutboundService: () => Pick<IOutboundMessageService, 'send'> | undefined;
  startChannel: (name: string) => void;
}

export function registerChannelsRoutes(router: Router, dependencies: ChannelsRouteDependencies): void {
  const { channelRepo, outboundRepo, getOutboundService, startChannel } = dependencies;

  router.get('/channels', (_req: Request, res: Response) => {
    res.json({ items: channelRepo.getAll() });
  });

  router.patch('/channels/:id/principal', (req: Request, res: Response) => {
    const updated = channelRepo.setPrincipal(String(req.params.id));
    if (!updated) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    res.json(updated);
  });

  router.get('/outbound', (_req: Request, res: Response) => {
    res.json({ items: outboundRepo.getAll() });
  });

  router.post('/outbound', async (req: Request, res: Response) => {
    const { content, channel, target } = req.body ?? {};

    if (typeof content !== 'string' || !content.trim()) {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    if (channel === undefined || target === undefined) {
      res.status(400).json({ error: 'channel and target are required.' });
      return;
    }

    if (!CHANNEL_TYPES.includes(channel as ChannelType)) {
      res.status(400).json({ error: `Invalid channel. Must be one of: ${CHANNEL_TYPES.join(', ')}.` });
      return;
    }

    const service = getOutboundService();
    if (!service) {
      res.status(503).json({ error: 'Outbound messaging is not available: no channel manager is running.' });
      return;
    }

    const message = await service.send({
      content: content.trim(),
      channel: String(channel),
      target: String(target),
    });

    if (message.status === 'failed') {
      res.status(502).json({ error: message.errorMessage ?? 'Failed to send the message.' });
      return;
    }

    res.status(201).json(message);
  });

  router.post('/whatsapp/connect', (_req: Request, res: Response) => {
    // WhatsApp pairing goes through Baileys' own terminal QR prompt
    // (plugins/whatsapp's startBaileysSocket already prints it via
    // qrcode-terminal) — this just triggers the live connection attempt.
    startChannel('whatsapp');
    res.json({ success: true });
  });
}
