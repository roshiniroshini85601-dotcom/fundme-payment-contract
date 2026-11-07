import { network } from "hardhat";
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { FundMeService } from "../../frontend/src/contractService.js";

// Mock localStorage for node environment
class MockLocalStorage {
  private store: Record<string, string> = {};
  getItem(key: string) {
    return this.store[key] || null;
  }
  setItem(key: string, value: string) {
    this.store[key] = String(value);
  }
  removeItem(key: string) {
    delete this.store[key];
  }
  clear() {
    this.store = {};
  }
}

// Mock EIP-1193 Coinbase Wallet Extension Provider
function createMockCoinbaseProvider(accountAddress: string, chainIdHex = "0x7a69", underlyingProvider?: any) {
  const listeners: Record<string, Function[]> = {};

  return {
    isCoinbaseWallet: true,
    isCoinbaseBrowser: true,
    selectedAddress: accountAddress,
    chainId: chainIdHex,

    async request({ method, params }: { method: string; params?: any[] }) {
      if (method === "eth_requestAccounts" || method === "eth_accounts") {
        return [accountAddress];
      }
      if (method === "eth_chainId") {
        return chainIdHex;
      }
      if (method === "eth_getBalance" && !underlyingProvider) {
        return "0x56bc75e2d63100000"; // 100 ETH
      }
      if (method === "wallet_switchEthereumChain") {
        const target = params?.[0]?.chainId;
        if (target === "0x9999") {
          const err: any = new Error("Unrecognized chain ID");
          err.code = 4902;
          throw err;
        }
        chainIdHex = target;
        return null;
      }
      if (method === "wallet_addEthereumChain") {
        return null;
      }
      if (underlyingProvider) {
        return underlyingProvider.request({ method, params });
      }
      return null;
    },

    on(event: string, handler: Function) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    },

    removeListener(event: string, handler: Function) {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter((h) => h !== handler);
    },

    emit(event: string, ...args: any[]) {
      if (!listeners[event]) return;
      listeners[event].forEach((h) => h(...args));
    },
  };
}

describe("Coinbase Wallet Browser Extension & Smart Contract Integration", function () {
  const testAccount = "0x1111111111111111111111111111111111111111";

  beforeEach(() => {
    // Setup window environment with global mocks
    const globalAny = global as any;
    globalAny.window = globalAny.window || {};
    globalAny.window.ethers = ethers;
    globalAny.localStorage = new MockLocalStorage();
    globalAny.window.localStorage = globalAny.localStorage;
    globalAny.dispatchEvent = () => true;
    globalAny.addEventListener = () => {};
    globalAny.window.addEventListener = () => {};
    globalAny.window.dispatchEvent = () => true;
  });

  it("should detect Coinbase Wallet extension when window.coinbaseWalletExtension is present", () => {
    const mockCoinbase = createMockCoinbaseProvider(testAccount);
    (global as any).window.coinbaseWalletExtension = mockCoinbase;
    (global as any).window.ethereum = { isMetaMask: true, isCoinbaseWallet: false };

    const service = new FundMeService();
    const detected = service.detectWallets();

    assert.equal(detected.isCoinbase, true, "Coinbase Wallet extension should be detected");
    assert.equal(detected.isMetaMask, true, "MetaMask should also be detected concurrently");
    assert.equal(service.getCoinbaseProvider(), mockCoinbase, "Should resolve dedicated Coinbase provider");
  });

  it("should detect Coinbase Wallet when present in window.ethereum.providers array", () => {
    const mockCoinbase = createMockCoinbaseProvider(testAccount);
    const mockMetaMask = { isMetaMask: true, isCoinbaseWallet: false };

    (global as any).window.coinbaseWalletExtension = undefined;
    (global as any).window.ethereum = {
      providers: [mockMetaMask, mockCoinbase],
    };

    const service = new FundMeService();
    const detected = service.detectWallets();

    assert.equal(detected.isCoinbase, true, "Coinbase Wallet should be detected from providers array");
    assert.equal(service.getCoinbaseProvider(), mockCoinbase, "Should resolve Coinbase from providers array");
  });

  it("should connect via Coinbase Wallet extension, get accounts and configure signer", async () => {
    const mockCoinbase = createMockCoinbaseProvider(testAccount);
    (global as any).window.coinbaseWalletExtension = mockCoinbase;
    (global as any).window.ethereum = { isMetaMask: true };

    const service = new FundMeService();
    const result = await service.connectCoinbase();

    assert.equal(result.walletType, "Coinbase");
    assert.equal(result.address, testAccount);
    assert.equal(result.chainId, 31337);
    assert.equal(service.userAddress, testAccount);
    assert.equal(service.walletType, "Coinbase");
    assert.equal(localStorage.getItem("fundme_last_wallet"), "Coinbase");
  });

  it("should bind deployed smart contract to Coinbase Wallet signer upon connection", async () => {
    const { viem } = await network.create();
    const [deployer] = await viem.getWalletClients();

    // Deploy contract on local Hardhat network
    const platform = await viem.deployContract("FundMePlatform", [
      deployer.account.address,
      deployer.account.address,
    ]);

    const publicClient = await viem.getPublicClient();
    const mockCoinbase = createMockCoinbaseProvider(deployer.account.address, "0x7a69", publicClient);
    (global as any).window.coinbaseWalletExtension = mockCoinbase;

    const service = new FundMeService();
    service.setContractAddress(platform.address);

    assert.equal(service.contractAddress, platform.address);

    // Connect Coinbase Wallet
    await service.connectCoinbase();
    assert.ok(service.contract, "Contract instance should be initialized");
    assert.ok(service.signer, "Signer should be initialized from Coinbase Wallet");

    // Verify nextCampaignId read via service contract
    const nextId = await service.getNextCampaignId();
    assert.equal(nextId, 0, "Initial nextCampaignId should be 0");
  });

  it("should handle chain switching and automatic network addition for error 4902", async () => {
    let addedChainParams: any = null;
    const baseMock = createMockCoinbaseProvider(testAccount);
    const mockCoinbase = {
      ...baseMock,
      async request({ method, params }: { method: string; params?: any[] }) {
        if (method === "wallet_switchEthereumChain") {
          const err: any = new Error("Unrecognized chain ID");
          err.code = 4902;
          throw err;
        }
        if (method === "wallet_addEthereumChain") {
          addedChainParams = params?.[0];
          return null;
        }
        return baseMock.request({ method, params });
      },
    };
    (global as any).window.coinbaseWalletExtension = mockCoinbase;

    const service = new FundMeService();
    await service.connectCoinbase();

    // Attempt switching to Hardhat localhost (0x7a69)
    await service.switchNetwork("0x7a69");
    assert.ok(addedChainParams, "wallet_addEthereumChain should be invoked on error 4902");
    assert.equal(addedChainParams.chainId, "0x7a69");
    assert.equal(addedChainParams.chainName, "Hardhat Localhost");
  });

  it("should cleanly disconnect and reset wallet state", async () => {
    const mockCoinbase = createMockCoinbaseProvider(testAccount);
    (global as any).window.coinbaseWalletExtension = mockCoinbase;

    const service = new FundMeService();
    await service.connectCoinbase();
    assert.equal(service.walletType, "Coinbase");

    service.disconnect();
    assert.equal(service.walletType, null);
    assert.equal(service.userAddress, null);
    assert.equal(service.signer, null);
    assert.equal(service.contract, null);
    assert.equal(localStorage.getItem("fundme_last_wallet"), null);
  });
});
