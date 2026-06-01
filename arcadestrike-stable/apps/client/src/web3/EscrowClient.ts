export class EscrowClient {
  constructor(private contractAddress: string) {}

  async deposit(_amount: bigint): Promise<string> {
    throw new Error('EscrowClient: not implemented — wire ethers.js Contract here');
  }

  async withdraw(_amount: bigint): Promise<string> {
    throw new Error('EscrowClient: not implemented');
  }
}
