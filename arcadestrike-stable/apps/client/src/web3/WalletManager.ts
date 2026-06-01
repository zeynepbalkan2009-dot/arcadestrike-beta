export class WalletManager {
  private _address: string | null = null;

  async connect(): Promise<string> {
    if (typeof window === 'undefined' || !(window as any).ethereum) {
      throw new Error('MetaMask not installed');
    }
    const accounts = await (window as any).ethereum.request({ method: 'eth_requestAccounts' });
    this._address = accounts[0];
    return this._address!;
  }

  get address(): string | null { return this._address; }
  get connected(): boolean     { return this._address !== null; }
}
