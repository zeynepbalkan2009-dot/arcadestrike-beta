export interface SignerTransferRequest {
  withdrawalId: string;
  playerId: string;
  amountWei: string;
  toAddress: string;
}

export interface SignerTransferResult {
  txHash: string;
}

export interface SignerService {
  sendWithdrawal(request: SignerTransferRequest): Promise<SignerTransferResult>;
}

export class DisabledSignerService implements SignerService {
  async sendWithdrawal(): Promise<SignerTransferResult> {
    throw new Error("Withdrawal signer service is not configured");
  }
}
