import { logger } from '../utils/logger';

export class OracleService {
  async getTokenPrice(): Promise<number> {
    if (!process.env.RPC_URL) {
      logger.warn('[OracleService] RPC_URL not set — returning mock price');
      return 1.0;
    }
    // TODO: implement on-chain price oracle
    return 1.0;
  }
}
