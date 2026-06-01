import { logger } from '../utils/logger';

export class EscrowWatcher {
  private _running = false;

  start(): void {
    if (!process.env.RPC_URL || !process.env.ESCROW_ADDRESS) {
      logger.warn('[EscrowWatcher] RPC_URL or ESCROW_ADDRESS not set — watcher disabled');
      return;
    }
    this._running = true;
    logger.info('[EscrowWatcher] started');
  }

  stop(): void {
    this._running = false;
    logger.info('[EscrowWatcher] stopped');
  }
}
