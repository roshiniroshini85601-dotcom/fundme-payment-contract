import { FUNDME_ABI } from "./abi.js";
import { ERC20_ABI } from "./erc20Abi.js";
export class FundMeService {
  constructor() {
    this.provider = null;
    this.signer = null;
    this.rawProvider = null;
    this.contract = null;
    const SEPOLIA_ADDRESS = "0x2c32e5949a12f394261fa8568e0092dd8c468492";
    let stored = null;
    if (typeof localStorage !== "undefined") {
      stored = localStorage.getItem("fundme_contract_address");
      if (!stored || stored === "0x0165878a594ca255338adfa4d48449f69242eb8f") {
        localStorage.setItem("fundme_contract_address", SEPOLIA_ADDRESS);
        stored = SEPOLIA_ADDRESS;
      }
    }
    this.contractAddress = stored || SEPOLIA_ADDRESS;
    this.userAddress = null;
    this.chainId = null;
    this.walletType = null;
    this.isSimulated = false;
    this.onAccountChange = null;
    this.onNetworkChange = null;
    this.eip6963Providers = new Map();
    this._initEIP6963();
  }
  _initEIP6963() {
    if (typeof window === "undefined") return;
    window.addEventListener("eip6963:announceProvider", (event) => {
      const detail = event.detail;
      if (detail && detail.info && detail.provider) {
        this.eip6963Providers.set(detail.info.rdns, detail);
      }
    });
    window.dispatchEvent(new Event("eip6963:requestProvider"));
  }
  loadContractForChain(chainId) {
    this.chainId = chainId;
    const SEPOLIA_DEFAULT = "0x2c32e5949a12f394261fa8568e0092dd8c468492";
    let addr = "";
    if (typeof localStorage !== "undefined") {
      addr = localStorage.getItem(`fundme_contract_address_${chainId}`);
      if (!addr || addr === "0x0165878a594ca255338adfa4d48449f69242eb8f") {
        addr = localStorage.getItem("fundme_contract_address");
      }
    }
    if (!addr || addr === "0x0165878a594ca255338adfa4d48449f69242eb8f") {
      addr = SEPOLIA_DEFAULT;
    }
    this.contractAddress = addr || SEPOLIA_DEFAULT;
    if (this.signer && this.contractAddress) {
      this.contract = new window.ethers.Contract(this.contractAddress, FUNDME_ABI, this.signer);
    } else {
      this.contract = null;
    }
    return this.contractAddress;
  }
  setContractAddress(address) {
    this.contractAddress = address.trim();
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("fundme_contract_address", this.contractAddress);
      if (this.chainId) {
        localStorage.setItem(`fundme_contract_address_${this.chainId}`, this.contractAddress);
      }
    }
    if (this.signer && this.contractAddress) {
      this.contract = new window.ethers.Contract(this.contractAddress, FUNDME_ABI, this.signer);
    } else {
      this.contract = null;
    }
  }
  getCoinbaseProvider() {
    if (typeof window === "undefined") return null;
    if (window.coinbaseWalletExtension) {
      return window.coinbaseWalletExtension;
    }
    if (window.ethereum?.providers?.length) {
      const cb = window.ethereum.providers.find(
        (p) => p.isCoinbaseWallet || p.isCoinbaseBrowser || p.overrideIsCoinbaseWallet
      );
      if (cb) return cb;
    }
    if (window.ethereum?.isCoinbaseWallet) {
      return window.ethereum;
    }
    for (const [rdns, detail] of this.eip6963Providers.entries()) {
      if (rdns.includes("coinbase") || detail.info?.name?.toLowerCase().includes("coinbase")) {
        return detail.provider;
      }
    }
    return null;
  }
  getMetaMaskProvider() {
    if (typeof window === "undefined") return null;
    if (window.ethereum?.providers?.length) {
      const mm = window.ethereum.providers.find(
        (p) => p.isMetaMask && !p.isCoinbaseWallet && !p.isBraveWallet
      );
      if (mm) return mm;
    }
    if (window.ethereum?.isMetaMask && !window.ethereum?.isCoinbaseWallet && !window.ethereum?.isBraveWallet) {
      return window.ethereum;
    }
    for (const [rdns, detail] of this.eip6963Providers.entries()) {
      if (rdns.includes("metamask") || detail.info?.name?.toLowerCase().includes("metamask")) {
        return detail.provider;
      }
    }
    return window.ethereum || null;
  }
  getBraveProvider() {
    if (typeof window === "undefined") return null;
    if (window.ethereum?.providers?.length) {
      const br = window.ethereum.providers.find((p) => p.isBraveWallet);
      if (br) return br;
    }
    if (window.ethereum?.isBraveWallet) return window.ethereum;
    return null;
  }
  initCoinbaseWalletSDK(options = {}) {
    if (typeof window === "undefined" || !window.CoinbaseWalletSDK) return null;
    const sdk = new window.CoinbaseWalletSDK({
      appName: options.appName || "FundMe Crowdfunding",
      appLogoUrl: options.appLogoUrl || "https://ethereum.org/static/a18397d4fc08e84ad8233181082e07d5/14a42/ethereum-logo-story.png",
      darkMode: true,
      reloadOnDisconnect: false,
    });
    return sdk.makeWeb3Provider();
  }
  detectWallets() {
    const isCoinbase = !!this.getCoinbaseProvider();
    const hasCoinbaseSDK = typeof window !== "undefined" && !!window.CoinbaseWalletSDK;
    const isMetaMask = !!this.getMetaMaskProvider();
    const isBrave = !!this.getBraveProvider();
    const hasAny = isCoinbase || isMetaMask || isBrave || (typeof window !== "undefined" && !!window.ethereum) || hasCoinbaseSDK;
    return {
      hasAny,
      isCoinbase,
      hasCoinbaseSDK,
      isMetaMask,
      isBrave,
      isInjected: !!window.ethereum || isCoinbase,
    };
  }
  async _connectProvider(rawProvider, walletType) {
    if (!rawProvider) {
      throw new Error(`${walletType} provider is not available.`);
    }
    this.isSimulated = false;
    this.walletType = walletType;
    this.rawProvider = rawProvider;
    this.provider = new window.ethers.BrowserProvider(rawProvider);
    const accounts = await rawProvider.request({ method: "eth_requestAccounts" });
    if (!accounts || accounts.length === 0) {
      throw new Error(`No accounts selected in ${walletType}.`);
    }
    this.signer = await this.provider.getSigner();
    this.userAddress = accounts[0];
    const network = await this.provider.getNetwork();
    this.chainId = Number(network.chainId);
    this.loadContractForChain(this.chainId);
    if (this.contractAddress) {
      this.contract = new window.ethers.Contract(this.contractAddress, FUNDME_ABI, this.signer);
    }
    localStorage.setItem("fundme_last_wallet", walletType);
    this._cleanupListeners();
    this._accountListener = (newAccounts) => {
      this.userAddress = newAccounts.length > 0 ? newAccounts[0] : null;
      if (this.contractAddress && this.signer) {
        this.contract = new window.ethers.Contract(this.contractAddress, FUNDME_ABI, this.signer);
      }
      if (this.onAccountChange) this.onAccountChange(this.userAddress);
    };
    if (typeof rawProvider.on === "function") {
      rawProvider.on("accountsChanged", this._accountListener);
    }
    this._chainListener = (hexChainId) => {
      this.chainId = typeof hexChainId === "string" ? parseInt(hexChainId, 16) : Number(hexChainId);
      if (this.onNetworkChange) this.onNetworkChange(this.chainId);
      window.location.reload();
    };
    if (typeof rawProvider.on === "function") {
      rawProvider.on("chainChanged", this._chainListener);
    }
    this._disconnectListener = () => {
      this.disconnect();
      if (this.onAccountChange) this.onAccountChange(null);
    };
    if (typeof rawProvider.on === "function") {
      rawProvider.on("disconnect", this._disconnectListener);
    }
    return {
      address: this.userAddress,
      chainId: this.chainId,
      balance: await this.getUserBalance(),
      walletType,
      isSimulated: false,
    };
  }
  async connectCoinbase(forceSdk = false) {
    let raw = !forceSdk ? this.getCoinbaseProvider() : null;
    if (!raw && typeof window !== "undefined" && window.CoinbaseWalletSDK) {
      try {
        raw = this.initCoinbaseWalletSDK();
      } catch (err) {
        console.warn("CoinbaseWalletSDK init failed:", err);
      }
    }
    if (!raw) {
      const err = new Error("Coinbase Wallet extension is not installed. Please install it from Chrome Web Store.");
      err.code = "COINBASE_NOT_INSTALLED";
      err.installUrl = "https://chromewebstore.google.com/detail/coinbase-wallet-extension/hnfanknocfeofbddgcijnmhnfnkdnaad";
      throw err;
    }
    return this._connectProvider(raw, "Coinbase");
  }
  async connectMetaMask() {
    const raw = this.getMetaMaskProvider();
    if (!raw) {
      throw new Error("MetaMask is not installed. Please install the extension.");
    }
    return this._connectProvider(raw, "MetaMask");
  }
  async connectBrave() {
    const raw = this.getBraveProvider();
    if (!raw) {
      throw new Error("Brave Wallet is not active or installed.");
    }
    return this._connectProvider(raw, "Brave");
  }
  async connectInjected() {
    const raw = window.ethereum;
    if (!raw) {
      throw new Error("No injected Web3 wallet found.");
    }
    return this._connectProvider(raw, "Injected");
  }
  async connectSimulated() {
    this.isSimulated = true;
    this.walletType = "simulated";
    this.userAddress = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
    this.chainId = 31337;
    localStorage.setItem("fundme_last_wallet", "simulated");
    return {
      address: this.userAddress,
      chainId: 31337,
      balance: "100.00",
      walletType: "simulated",
      isSimulated: true,
    };
  }
  disconnect() {
    this._cleanupListeners();
    if (this.rawProvider && typeof this.rawProvider.close === "function") {
      try { this.rawProvider.close(); } catch (_) { }
    }
    this.provider = null;
    this.signer = null;
    this.rawProvider = null;
    this.contract = null;
    this.userAddress = null;
    this.chainId = null;
    this.walletType = null;
    this.isSimulated = false;
    localStorage.removeItem("fundme_last_wallet");
  }
  _cleanupListeners() {
    if (this.rawProvider && typeof this.rawProvider.removeListener === "function") {
      if (this._accountListener) this.rawProvider.removeListener("accountsChanged", this._accountListener);
      if (this._chainListener) this.rawProvider.removeListener("chainChanged", this._chainListener);
      if (this._disconnectListener) this.rawProvider.removeListener("disconnect", this._disconnectListener);
    }
    this._accountListener = null;
    this._chainListener = null;
    this._disconnectListener = null;
  }
  async getUserBalance() {
    if (!this.provider || !this.userAddress) return "0";
    try {
      const bal = await this.provider.getBalance(this.userAddress);
      return window.ethers.formatEther(bal);
    } catch {
      return "0";
    }
  }
  async switchNetwork(targetChainIdHex) {
    const p = this.rawProvider || window.ethereum;
    if (!p) return;
    try {
      await p.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: targetChainIdHex }]
      });
    } catch (err) {
      if (err.code === 4902 || (err.message && err.message.includes("wallet_addEthereumChain"))) {
        const chainParams = this._getChainParams(targetChainIdHex);
        if (chainParams) {
          await p.request({
            method: "wallet_addEthereumChain",
            params: [chainParams]
          });
        }
      } else {
        console.warn("Failed to switch network:", err);
        throw err;
      }
    }
  }
  _getChainParams(chainIdHex) {
    const id = parseInt(chainIdHex, 16);
    if (id === 31337) {
      return {
        chainId: "0x7a69",
        chainName: "Hardhat Localhost",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: ["http://127.0.0.1:8545"]
      };
    }
    if (id === 11155111) {
      return {
        chainId: "0xaa36a7",
        chainName: "Sepolia Testnet",
        nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: ["https://rpc.sepolia.org"],
        blockExplorerUrls: ["https://sepolia.etherscan.io"]
      };
    }
    return null;
  }
  _requireContract(requireSigner = true) {
    if (!this.contractAddress) {
      throw new Error("Contract address is not set. Please provide a deployed FundMePlatform contract address.");
    }
    if (this.contract && (!requireSigner || this.signer)) {
      return this.contract;
    }
    if (this.signer) {
      this.contract = new window.ethers.Contract(this.contractAddress, FUNDME_ABI, this.signer);
      return this.contract;
    }
    if (requireSigner) {
      throw new Error("Wallet is not connected. Please connect your Web3 wallet (e.g. Coinbase Wallet).");
    }
    const readProvider = this.provider || this._getReadProvider();
    if (readProvider) {
      return new window.ethers.Contract(this.contractAddress, FUNDME_ABI, readProvider);
    }
    throw new Error("No Web3 provider available to query contract.");
  }
  _getReadProvider() {
    const raw = this.getCoinbaseProvider() || this.getMetaMaskProvider() || window.ethereum;
    if (raw && window.ethers) {
      try {
        return new window.ethers.BrowserProvider(raw);
      } catch (_) { }
    }
    return null;
  }
  async getNextCampaignId() {
    const c = this._requireContract(false);
    const nextId = await c.nextCampaignId();
    return Number(nextId);
  }
  async getCampaign(campaignId) {
    const c = this._requireContract(false);
    const data = await c.campaigns(campaignId);
    const exists = data[6];
    if (!exists) return null;
    const id = Number(data[0]);
    const creator = data[1];
    const tokenAddress = data[2];
    const deadline = Number(data[3]);
    const isCompleted = data[4];
    const isFlexible = data[5];
    const targetGoalWei = data[7];
    const totalRaisedWei = data[8];
    const isNative = tokenAddress === "0x0000000000000000000000000000000000000000";
    const donors = await this.getCampaignDonors(id);
    const isKyc = await this.isKycVerified(creator);
    let isFrozen = false;
    try {
      isFrozen = await c.isCampaignFrozen(id);
    } catch (_) {}
    return {
      id,
      creator,
      isKycVerified: isKyc,
      isFrozen,
      tokenAddress,
      isNative,
      deadline,
      deadlineDate: new Date(deadline * 1000),
      isCompleted,
      isFlexible,
      exists,
      targetGoalWei: targetGoalWei.toString(),
      targetGoal: window.ethers.formatEther(targetGoalWei),
      totalRaisedWei: totalRaisedWei.toString(),
      totalRaised: window.ethers.formatEther(totalRaisedWei),
      progressPercent: targetGoalWei > 0n
        ? Math.min(100, Number((totalRaisedWei * 10000n) / targetGoalWei) / 100)
        : 0,
      isExpired: Date.now() >= deadline * 1000,
      donors,
      donorCount: donors.length
    };
  }
  async getCampaignDonors(campaignId) {
    if (this.isSimulated) {
      return [];
    }
    try {
      const c = this._requireContract(false);
      const filter = c.filters.ContributionReceived(campaignId);
      const events = await c.queryFilter(filter, 0, "latest");
      const donorMap = new Map();
      for (const ev of events) {
        const donor = ev.args[1] || ev.args.donor;
        const amountWei = BigInt(ev.args[2] || ev.args.amount || 0);
        const currentWei = donorMap.get(donor) || 0n;
        donorMap.set(donor, currentWei + amountWei);
      }
      const donorsList = [];
      for (const [donor, totalWei] of donorMap.entries()) {
        donorsList.push({
          donor,
          amountWei: totalWei.toString(),
          amount: window.ethers.formatEther(totalWei)
        });
      }
      return donorsList;
    } catch (err) {
      console.warn(`Error fetching donors for campaign ${campaignId}:`, err);
      return [];
    }
  }
  async getAllCampaigns() {
    const nextId = await this.getNextCampaignId();
    const campaigns = [];
    for (let i = 0; i < nextId; i++) {
      try {
        const camp = await this.getCampaign(i);
        if (camp) campaigns.push(camp);
      } catch (err) {
        console.warn(`Error loading campaign ${i}:`, err);
      }
    }
    return campaigns;
  }
  async getUserContribution(campaignId, userAddress) {
    const c = this._requireContract(false);
    const contrib = await c.contributions(campaignId, userAddress);
    return {
      wei: contrib.toString(),
      formatted: window.ethers.formatEther(contrib)
    };
  }
  async getCurrentTimestamp() {
    try {
      if (this.provider) {
        const block = await this.provider.getBlock("latest");
        if (block && block.timestamp) return Number(block.timestamp);
      }
    } catch (_) {}
    return Math.floor(Date.now() / 1000);
  }
  async isKycVerified(address) {
    if (!address) return false;
    if (this.isSimulated) {
      return address.toLowerCase() === "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
    }
    try {
      const c = this._requireContract(false);
      return await c.isKycVerified(address);
    } catch {
      return false;
    }
  }

  async _execTx(sendTxFn) {
    if (this.isSimulated) {
      await new Promise((r) => setTimeout(r, 400));
      return { hash: "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("") };
    }
    const tx = await sendTxFn();
    return await tx.wait();
  }

  async setKycStatus(address, status) {
    return this._execTx(() => this._requireContract(true).setKycStatus(address, status, { gasLimit: 120000n }));
  }

  async setCampaignFrozen(campaignId, frozen) {
    if (this.isSimulated) return { hash: "0xsimulated" };
    return this._execTx(() => this._requireContract(true).setCampaignFrozen(campaignId, frozen, { gasLimit: 100000n }));
  }

  async isCampaignFrozen(campaignId) {
    if (this.isSimulated) return false;
    try {
      const c = this._requireContract(false);
      return await c.isCampaignFrozen(campaignId);
    } catch {
      return false;
    }
  }

  async isKycAdmin() {
    if (this.isSimulated) return true;
    if (!this.userAddress) return false;
    try {
      const c = this._requireContract(false);
      const [KYC_ROLE, DEFAULT_ADMIN] = await Promise.all([c.KYC_ROLE(), c.DEFAULT_ADMIN_ROLE()]);
      const [hasKyc, hasAdmin] = await Promise.all([
        c.hasRole(KYC_ROLE, this.userAddress),
        c.hasRole(DEFAULT_ADMIN, this.userAddress)
      ]);
      return hasKyc || hasAdmin;
    } catch {
      return false;
    }
  }

  async getAllTransactions(filterAddress = null) {
    if (!this.contract && !this.provider) return [];
    try {
      const c = this._requireContract(false);
      const onChainTxs = [];
      const blockTimes = new Map();

      const getTime = async (b) => {
        if (!b) return Math.floor(Date.now() / 1000);
        if (blockTimes.has(b)) return blockTimes.get(b);
        try {
          const blk = await this.provider?.getBlock(b);
          if (blk?.timestamp) {
            const t = Number(blk.timestamp);
            blockTimes.set(b, t);
            return t;
          }
        } catch (_) {}
        return Math.floor(Date.now() / 1000);
      };

      const eventConfigs = [
        {
          name: "ContributionReceived",
          parse: (ev, time) => ({
            id: `tx_${ev.transactionHash}_${ev.index ?? 0}`,
            type: "donation",
            title: `Donation to Campaign #${Number(ev.args[0])}`,
            campaignId: Number(ev.args[0]),
            from: ev.args[1],
            to: this.contractAddress,
            amount: parseFloat(window.ethers.formatEther(ev.args[2])).toFixed(4),
            token: ev.args[3] === "0x0000000000000000000000000000000000000000" ? "ETH" : "Tokens",
            hash: ev.transactionHash,
            blockNumber: ev.blockNumber,
            timestamp: time
          })
        },
        {
          name: "WithdrawalExecuted",
          parse: (ev, time) => ({
            id: `tx_${ev.transactionHash}_${ev.index ?? 0}`,
            type: "withdrawal",
            title: `Withdrawal from Campaign #${Number(ev.args[0])}`,
            campaignId: Number(ev.args[0]),
            from: this.contractAddress,
            to: ev.args[1],
            amount: parseFloat(window.ethers.formatEther(ev.args[2])).toFixed(4),
            token: "ETH",
            hash: ev.transactionHash,
            blockNumber: ev.blockNumber,
            timestamp: time
          })
        },
        {
          name: "RefundClaimed",
          parse: (ev, time) => ({
            id: `tx_${ev.transactionHash}_${ev.index ?? 0}`,
            type: "refund",
            title: `Refund for Campaign #${Number(ev.args[0])}`,
            campaignId: Number(ev.args[0]),
            from: this.contractAddress,
            to: ev.args[1],
            amount: parseFloat(window.ethers.formatEther(ev.args[2])).toFixed(4),
            token: "ETH",
            hash: ev.transactionHash,
            blockNumber: ev.blockNumber,
            timestamp: time
          })
        },
        {
          name: "CampaignCreated",
          parse: (ev, time) => ({
            id: `tx_${ev.transactionHash}_${ev.index ?? 0}`,
            type: "created",
            title: `Created Campaign #${Number(ev.args[0])}`,
            campaignId: Number(ev.args[0]),
            from: ev.args[1],
            amount: parseFloat(window.ethers.formatEther(ev.args[3])).toFixed(2),
            token: "ETH Goal",
            hash: ev.transactionHash,
            blockNumber: ev.blockNumber,
            timestamp: time
          })
        },
        {
          name: "CampaignCanceled",
          parse: (ev, time) => ({
            id: `tx_${ev.transactionHash}_${ev.index ?? 0}`,
            type: "canceled",
            title: `Canceled Campaign #${Number(ev.args[0])}`,
            campaignId: Number(ev.args[0]),
            from: ev.args[1],
            amount: "0",
            token: "ETH",
            hash: ev.transactionHash,
            blockNumber: ev.blockNumber,
            timestamp: time
          })
        }
      ];

      for (const { name, parse } of eventConfigs) {
        try {
          const events = await c.queryFilter(c.filters[name](), 0, "latest");
          for (const ev of events) {
            const time = await getTime(ev.blockNumber);
            onChainTxs.push(parse(ev, time));
          }
        } catch (_) {}
      }

      onChainTxs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      if (filterAddress) {
        const lower = filterAddress.toLowerCase();
        return onChainTxs.filter(
          (t) => (t.from && t.from.toLowerCase() === lower) || (t.to && t.to.toLowerCase() === lower)
        );
      }
      return onChainTxs;
    } catch (err) {
      console.warn("Failed to fetch live on-chain transactions:", err);
      return [];
    }
  }

  async createCampaign(tokenAddress, targetGoalETH, durationInDaysOrSeconds, isFlexible, isSeconds = false) {
    const targetGoalWei = window.ethers.parseEther(targetGoalETH.toString());
    return this._execTx(async () => {
      const c = this._requireContract(true);
      if (isSeconds) {
        const blockTimestamp = await this.getCurrentTimestamp();
        const deadline = BigInt(blockTimestamp + Number(durationInDaysOrSeconds));
        const fn = typeof c.getFunction === "function"
          ? c.getFunction("createCampaign(address,uint256,uint64,address)")
          : (c["createCampaign(address,uint256,uint64,address)"] || c.createCampaign);
        return fn(this.userAddress, targetGoalWei, deadline, tokenAddress, { gasLimit: 300000n });
      }
      const fn = typeof c.getFunction === "function"
        ? c.getFunction("createCampaign(address,uint256,uint256,bool)")
        : (c["createCampaign(address,uint256,uint256,bool)"] || c.createCampaign);
      return fn(tokenAddress, targetGoalWei, BigInt(durationInDaysOrSeconds), isFlexible, { gasLimit: 300000n });
    });
  }

  async contributeETH(campaignId, amountETH) {
    const num = parseFloat(amountETH);
    if (isNaN(num) || num < 0.0001) {
      throw new Error("Minimum contribution is 0.0001 ETH.");
    }
    if (num > 1000) {
      throw new Error("Maximum contribution is 1,000 ETH.");
    }
    const value = window.ethers.parseEther(amountETH.toString());
    return this._execTx(() => this._requireContract(true).contributeETH(campaignId, { value, gasLimit: 200000n }));
  }

  async contributeToken(campaignId, tokenAddress, amountTokens, onStatusUpdate) {
    const num = parseFloat(amountTokens);
    if (isNaN(num) || num < 0.0001) {
      throw new Error("Minimum contribution is 0.0001 tokens.");
    }
    if (num > 1000) {
      throw new Error("Maximum contribution is 1,000 tokens.");
    }
    return this._execTx(async () => {
      const tokenContract = new window.ethers.Contract(tokenAddress, ERC20_ABI, this.signer);
      const decimals = await tokenContract.decimals();
      const amountWei = window.ethers.parseUnits(amountTokens.toString(), decimals);
      
      const userBal = await tokenContract.balanceOf(this.userAddress).catch(() => 0n);
      if (userBal < amountWei) {
        const symbol = await tokenContract.symbol().catch(() => "Tokens");
        const formattedBal = window.ethers.formatUnits(userBal, decimals);
        throw new Error(`Insufficient ${symbol} balance! Your balance is ${formattedBal} ${symbol}. Please mint test tokens first.`);
      }

      const allowance = await tokenContract.allowance(this.userAddress, this.contractAddress);
      if (allowance < amountWei) {
        if (onStatusUpdate) onStatusUpdate("Requesting token approval...");
        await (await tokenContract.approve(this.contractAddress, amountWei)).wait();
      }
      if (onStatusUpdate) onStatusUpdate("Contributing tokens...");
      return this._requireContract(true).contributeToken(campaignId, amountWei);
    });
  }

  async withdrawFunds(campaignId) {
    return this._execTx(() => this._requireContract(true).withdrawFunds(campaignId, { gasLimit: 250000n }));
  }

  async claimRefund(campaignId) {
    return this._execTx(() => this._requireContract(true).claimRefund(campaignId, { gasLimit: 200000n }));
  }

  async cancelCampaign(campaignId) {
    return this._execTx(() => this._requireContract(true).cancelCampaign(campaignId, { gasLimit: 150000n }));
  }

  async batchRefund(campaignId, donorAddresses) {
    return this._execTx(() => this._requireContract(true).batchRefund(campaignId, donorAddresses, { gasLimit: 500000n }));
  }

  async getLatestETHPrice() {
    try {
      const c = this._requireContract(false);
      const rawPrice = await c.getLatestETHPrice();
      return Number(rawPrice) / 1e8;
    } catch {
      return 2500.0;
    }
  }

  async getETHAmountFromUSD(usdAmount) {
    try {
      const c = this._requireContract(false);
      const usdWei = window.ethers.parseEther(usdAmount.toString());
      const ethWei = await c.getETHAmountFromUSD(usdWei);
      return window.ethers.formatEther(ethWei);
    } catch {
      const price = await this.getLatestETHPrice();
      return (Number(usdAmount) / price).toFixed(6);
    }
  }

  async switchAccount() {
    if (!this.rawProvider) throw new Error("No wallet connected.");
    const accounts = await this.rawProvider.request({ method: "eth_requestAccounts" });
    if (!accounts || accounts.length === 0) throw new Error("No account selected.");
    this.signer = await this.provider.getSigner();
    this.userAddress = accounts[0];
    if (this.contractAddress) {
      this.contract = new window.ethers.Contract(this.contractAddress, FUNDME_ABI, this.signer);
    }
    return this.userAddress;
  }

  getDefaultTokenAddress() {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem("fundme_token_address");
      if (stored && stored !== "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853") return stored;
    }
    return "0x0c12b1ee0a59b79755c6a20bdc115c4d837af7a0";
  }

  setDefaultTokenAddress(address) {
    if (typeof localStorage !== "undefined" && address) {
      localStorage.setItem("fundme_token_address", address.trim());
    }
  }

  async getTokenDetails(tokenAddress, userAddress) {
    if (!tokenAddress || tokenAddress === "0x0000000000000000000000000000000000000000") return null;
    try {
      const readProvider = this.signer || this.provider || this._getReadProvider();
      if (!readProvider) return null;
      const tokenContract = new window.ethers.Contract(tokenAddress, ERC20_ABI, readProvider);
      const [name, symbol, decimals] = await Promise.all([
        tokenContract.name().catch(() => "Test Token"),
        tokenContract.symbol().catch(() => "TOKEN"),
        tokenContract.decimals().catch(() => 18)
      ]);
      let balance = "0";
      const targetUser = userAddress || this.userAddress;
      if (targetUser) {
        const rawBal = await tokenContract.balanceOf(targetUser).catch(() => 0n);
        balance = window.ethers.formatUnits(rawBal, decimals);
      }
      return { name, symbol, decimals, balance, address: tokenAddress };
    } catch (err) {
      console.warn("Failed to fetch token details:", err);
      return null;
    }
  }

  async mintTokens(tokenAddress, amountTokens, toAddress = null) {
    const targetRecipient = toAddress || this.userAddress;
    if (!targetRecipient) throw new Error("Wallet not connected. Please connect your wallet first.");
    if (!tokenAddress || !window.ethers.isAddress(tokenAddress)) {
      throw new Error("Invalid token contract address.");
    }
    const num = parseFloat(amountTokens);
    if (isNaN(num) || num <= 0) {
      throw new Error("Please enter a valid amount of tokens to mint.");
    }

    return this._execTx(async () => {
      const tokenContract = new window.ethers.Contract(tokenAddress, ERC20_ABI, this.signer);
      const decimals = await tokenContract.decimals().catch(() => 18);
      const amountWei = window.ethers.parseUnits(amountTokens.toString(), decimals);
      return tokenContract.mint(targetRecipient, amountWei);
    });
  }

  async addTokenToWallet(tokenAddress) {
    const raw = this.rawProvider || window.ethereum;
    if (!raw) throw new Error("No Web3 wallet found.");
    const details = await this.getTokenDetails(tokenAddress);
    return raw.request({
      method: "wallet_watchAsset",
      params: {
        type: "ERC20",
        options: {
          address: tokenAddress,
          symbol: details?.symbol || "tUSDC",
          decimals: details?.decimals || 18,
        },
      },
    });
  }
}
