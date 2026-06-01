import { logger } from '../utils/logger';

export class SignerService {
  async sendTransaction(_to: string, _amount: bigint): Promise<string> {
    if (!process.env.SIGNER_PRIVATE_KEY || !process.env.RPC_URL) {
      logger.warn('[SignerService] SIGNER_PRIVATE_KEY or RPC_URL not set — TX disabled');
      throw new Error('Signer not configured');
    }
    // TODO: implement ethers.js transaction signing
    throw new Error('SignerService not yet implemented');
  }
}
