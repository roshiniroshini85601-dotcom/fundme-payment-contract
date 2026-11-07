export const KNOWN_ACCOUNTS = {
  "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266": "Account #0",
  "0x70997970c51812dc3a010c7d01b50e0d17dc79c8": "Account #1",
  "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc": "Account #2",
  "0x90f79bf6eb2c4f870365e785982e1f101e93b906": "Account #3",
  "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65": "Account #4",
  "0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc": "Account #5",
  "0x976ea74026e726554db657fa54763abd0c3a0aa9": "Account #6",
  "0x14dc79964da2c08b23698b3d3cc7ca32193d9955": "Account #7",
  "0x23618e81e3f5cdf7f54c3d65f7fbc0abf5b21e8f": "Account #8",
  "0x23b0f134098ebe61d80932275c9603bf0f0b15b0": "MetaMask Account 7",
};

export function formatAccount(address) {
  if (!address) return "0x0...";
  const lower = address.toLowerCase();
  const label = KNOWN_ACCOUNTS[lower];
  const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
  return label ? `${label} (${short})` : short;
}

export function showToast(message, type = "info") {
  const toastContainer = document.getElementById("toastContainer");
  if (!toastContainer) return;
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div style="font-size: 1.2rem;">${type === "success" ? "✅" : type === "error" ? "❌" : "ℹ️"}</div>
    <div style="flex: 1; font-size: 0.9rem;">${message}</div>
  `;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(100%)";
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}

export function formatTxError(err) {
  if (!err) return "Transaction failed.";
  if (err.code === "ACTION_REJECTED" || err.code === 4001 || (err.message && err.message.includes("rejected"))) {
    return "Transaction was cancelled / rejected in wallet.";
  }
  const fullMsg = ((err.message || "") + " " + (err.error?.message || "") + " " + (err.info?.error?.message || "")).toLowerCase();
  if (err.code === "INSUFFICIENT_FUNDS" || fullMsg.includes("insufficient funds") || fullMsg.includes("exceeds balance")) {
    return "Insufficient balance: Your connected wallet has 0 ETH or not enough to cover the donation + gas fees.";
  }
  if (err.info?.error?.message) {
    const match = err.info.error.message.match(/reverted with custom error '([^']+)'/);
    if (match) return `Reverted: ${match[1]}`;
    return err.info.error.message;
  }
  if (err.error?.message) return err.error.message;
  if (err.shortMessage && !err.shortMessage.toLowerCase().includes("coalesce")) return err.shortMessage;
  if (err.reason) return err.reason;
  return err.message || "Transaction failed";
}

export function openModal(modal) {
  if (modal) modal.classList.add("active");
}

export function closeModal(modal) {
  if (modal) modal.classList.remove("active");
}

export async function copyToClipboard(text, message = "Copied to clipboard!") {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    showToast(message, "success");
  } catch (err) {
    showToast("Failed to copy to clipboard", "error");
  }
}

export function initWalletUI(fundMe, onRefreshNeeded) {
  const connectWalletBtn = document.getElementById("connectWalletBtn");
  const walletConnectedStrip = document.getElementById("walletConnectedStrip");
  const walletAddrLabel = document.getElementById("walletAddrLabel");
  const walletTypeBadge = document.getElementById("walletTypeBadge");
  const walletAvatar = document.getElementById("walletAvatar");
  const networkBadge = document.getElementById("networkBadge");
  const statusDot = document.getElementById("statusDot");
  const networkName = document.getElementById("networkName");
  const contractConfigBtn = document.getElementById("contractConfigBtn");
  const configModal = document.getElementById("configModal");
  const configForm = document.getElementById("configForm");
  const contractAddressInput = document.getElementById("contractAddressInput");

  const walletModal = document.getElementById("walletModal");
  const disconnectWalletBtn = document.getElementById("disconnectWalletBtn");
  const coinbaseInstallModal = document.getElementById("coinbaseInstallModal");
  const coinbaseSdkConnectBtn = document.getElementById("coinbaseSdkConnectBtn");
  const switchAccountBtn = document.getElementById("switchAccountBtn");
  const donateModalSwitchAccountBtn = document.getElementById("donateModalSwitchAccountBtn");
  const switchNetworkBannerBtn = document.getElementById("switchNetworkBannerBtn");
  const wrongBanner = document.getElementById("wrongNetworkBanner");

  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const modalId = btn.getAttribute("data-close");
      const m = document.getElementById(modalId);
      if (m) closeModal(m);
    });
  });

  window.addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-overlay")) {
      closeModal(e.target);
    }
  });

  function applyWalletConnectedUI(res) {
    if (connectWalletBtn) connectWalletBtn.style.display = "none";
    if (walletConnectedStrip) walletConnectedStrip.style.display = "flex";
    if (walletAddrLabel) walletAddrLabel.textContent = formatAccount(res.address);

    if (walletAvatar && walletTypeBadge) {
      if (res.walletType === "Coinbase") {
        walletAvatar.innerHTML = `<svg width="18" height="18" viewBox="0 0 36 36" fill="none" style="display:block"><rect width="36" height="36" rx="8" fill="#0052FF"/><rect x="8" y="8" width="20" height="20" rx="4" fill="#FFFFFF"/><rect x="13" y="13" width="10" height="10" rx="2.5" fill="#0052FF"/></svg>`;
        walletTypeBadge.className = "wallet-type-badge badge-coinbase";
        walletTypeBadge.textContent = "Coinbase";
      } else {
        const walletIcons = { MetaMask: "🦊", Brave: "🦁", Injected: "🔌", simulated: "🧪" };
        walletAvatar.textContent = walletIcons[res.walletType] || "🔗";
        walletTypeBadge.className = "wallet-type-badge";
        walletTypeBadge.textContent = res.isSimulated ? "Test Mode" : res.walletType;
      }
    }

    if (statusDot) statusDot.classList.remove("disconnected");
    const chainMap = { 31337: "Localhost (Hardhat)", 11155111: "Sepolia", 1: "Ethereum Mainnet" };
    const currentNetworkText = res.isSimulated
      ? "Test Network (Hardhat)"
      : chainMap[res.chainId] || `Chain ${res.chainId}`;

    if (networkBadge && networkName) {
      if (res.chainId !== 31337 && !res.isSimulated) {
        networkBadge.classList.add("wrong-network");
        networkBadge.title = "Click here to switch to Hardhat Local network!";
        networkName.textContent = `${currentNetworkText} ⚠️ (Click to switch to Hardhat Local)`;
        if (wrongBanner) wrongBanner.style.display = "flex";
      } else {
        networkBadge.classList.remove("wrong-network");
        networkBadge.title = "Connected to Hardhat Local";
        networkName.textContent = currentNetworkText;
        if (wrongBanner) wrongBanner.style.display = "none";
      }
    }
  }

  function applyWalletDisconnectedUI() {
    if (connectWalletBtn) connectWalletBtn.style.display = "inline-flex";
    if (walletConnectedStrip) walletConnectedStrip.style.display = "none";
    if (statusDot) statusDot.classList.add("disconnected");
    if (networkBadge) networkBadge.classList.remove("wrong-network");
    if (networkName) networkName.textContent = "Not Connected";
    if (wrongBanner) wrongBanner.style.display = "none";
  }

  async function triggerSwitchToLocalhost() {
    try {
      showToast("Requesting wallet to switch to Hardhat Localhost...", "info");
      await fundMe.switchNetwork("0x7a69");
      showToast("Successfully switched to Hardhat Localhost!", "success");
    } catch (err) {
      showToast(err.message || "Failed to switch network", "error");
    }
  }

  if (networkBadge) networkBadge.addEventListener("click", triggerSwitchToLocalhost);
  if (switchNetworkBannerBtn) switchNetworkBannerBtn.addEventListener("click", triggerSwitchToLocalhost);

  fundMe.onAccountChange = (newAddress) => {
    if (!newAddress) {
      applyWalletDisconnectedUI();
      showToast("Wallet disconnected", "info");
    } else {
      applyWalletConnectedUI({
        address: newAddress,
        chainId: fundMe.chainId,
        walletType: fundMe.walletType,
        isSimulated: fundMe.isSimulated,
      });
      showToast(`Account switched to ${formatAccount(newAddress)}`, "info");
    }
    if (onRefreshNeeded) onRefreshNeeded();
  };

  function initWalletModal() {
    const detected = fundMe.detectWallets();
    const optMeta = document.getElementById("walletOptMetaMask");
    const optCoinbase = document.getElementById("walletOptCoinbase");
    const optBrave = document.getElementById("walletOptBrave");
    const optInjected = document.getElementById("walletOptInjected");

    const tagMeta = document.getElementById("tagMetaMask");
    const tagCoinbase = document.getElementById("tagCoinbase");
    const tagBrave = document.getElementById("tagBrave");
    const tagInjected = document.getElementById("tagInjected");

    if (optCoinbase && tagCoinbase) {
      if (detected.isCoinbase) {
        optCoinbase.classList.remove("unavailable");
        tagCoinbase.textContent = "Extension Ready";
        tagCoinbase.classList.remove("unavailable-tag");
      } else if (detected.hasCoinbaseSDK) {
        optCoinbase.classList.remove("unavailable");
        tagCoinbase.textContent = "Connect / QR";
        tagCoinbase.classList.remove("unavailable-tag");
      } else {
        optCoinbase.classList.remove("unavailable");
        tagCoinbase.textContent = "Get Extension";
        tagCoinbase.classList.add("unavailable-tag");
      }
    }

    if (optMeta && tagMeta) {
      if (!detected.isMetaMask) {
        optMeta.classList.add("unavailable");
        tagMeta.textContent = "Not Installed";
        tagMeta.classList.add("unavailable-tag");
      } else {
        optMeta.classList.remove("unavailable");
        tagMeta.textContent = "Installed";
        tagMeta.classList.remove("unavailable-tag");
      }
    }

    if (optBrave && tagBrave) {
      if (!detected.isBrave) {
        optBrave.classList.add("unavailable");
        tagBrave.textContent = "Not Installed";
        tagBrave.classList.add("unavailable-tag");
      } else {
        optBrave.classList.remove("unavailable");
        tagBrave.textContent = "Installed";
        tagBrave.classList.remove("unavailable-tag");
      }
    }

    if (optInjected && tagInjected) {
      if (!detected.hasAny) {
        optInjected.classList.add("unavailable");
        tagInjected.textContent = "Not Installed";
        tagInjected.classList.add("unavailable-tag");
      } else {
        optInjected.classList.remove("unavailable");
        tagInjected.textContent = "Installed";
        tagInjected.classList.remove("unavailable-tag");
      }
    }
  }

  async function handleWalletConnect(walletMethodFn, optionEl) {
    if (optionEl) optionEl.classList.add("connecting");
    try {
      const res = await walletMethodFn();
      closeModal(walletModal);
      closeModal(coinbaseInstallModal);
      applyWalletConnectedUI(res);
      if (res.isSimulated) {
        showToast("Connected in Test Mode", "success");
      } else {
        showToast(`Connected: ${formatAccount(res.address)} via ${res.walletType}`, "success");
      }
      if (onRefreshNeeded) await onRefreshNeeded();
    } catch (err) {
      if (err.code === "COINBASE_NOT_INSTALLED") {
        closeModal(walletModal);
        openModal(coinbaseInstallModal);
      } else {
        showToast(err.message || "Connection failed", "error");
      }
    } finally {
      if (optionEl) optionEl.classList.remove("connecting");
    }
  }

  if (connectWalletBtn) {
    connectWalletBtn.addEventListener("click", () => {
      initWalletModal();
      openModal(walletModal);
    });
  }

  const optMetaMask = document.getElementById("walletOptMetaMask");
  if (optMetaMask) {
    optMetaMask.addEventListener("click", () => {
      handleWalletConnect(() => fundMe.connectMetaMask(), optMetaMask);
    });
  }

  const optCoinbase = document.getElementById("walletOptCoinbase");
  if (optCoinbase) {
    optCoinbase.addEventListener("click", () => {
      const detected = fundMe.detectWallets();
      if (detected.isCoinbase) {
        handleWalletConnect(() => fundMe.connectCoinbase(), optCoinbase);
      } else if (detected.hasCoinbaseSDK) {
        handleWalletConnect(() => fundMe.connectCoinbase(true), optCoinbase);
      } else {
        closeModal(walletModal);
        openModal(coinbaseInstallModal);
      }
    });
  }

  if (coinbaseSdkConnectBtn) {
    coinbaseSdkConnectBtn.addEventListener("click", () => {
      closeModal(coinbaseInstallModal);
      handleWalletConnect(() => fundMe.connectCoinbase(true), optCoinbase);
    });
  }

  const optBrave = document.getElementById("walletOptBrave");
  if (optBrave) {
    optBrave.addEventListener("click", () => {
      if (optBrave.classList.contains("unavailable")) return;
      handleWalletConnect(() => fundMe.connectBrave(), optBrave);
    });
  }

  const optInjected = document.getElementById("walletOptInjected");
  if (optInjected) {
    optInjected.addEventListener("click", () => {
      if (optInjected.classList.contains("unavailable")) return;
      handleWalletConnect(() => fundMe.connectInjected(), optInjected);
    });
  }

  const optTest = document.getElementById("walletOptTest");
  if (optTest) {
    optTest.addEventListener("click", () => {
      handleWalletConnect(() => fundMe.connectSimulated(), optTest);
    });
  }

  if (walletConnectedStrip) {
    walletConnectedStrip.addEventListener("click", (e) => {
      if (e.target.id === "disconnectWalletBtn" || e.target.id === "switchAccountBtn") return;
      if (fundMe.userAddress) {
        copyToClipboard(fundMe.userAddress, `Copied ${formatAccount(fundMe.userAddress)} to clipboard!`);
      }
    });
  }

  if (disconnectWalletBtn) {
    disconnectWalletBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      fundMe.disconnect();
      applyWalletDisconnectedUI();
      showToast("Wallet disconnected", "info");
      if (onRefreshNeeded) onRefreshNeeded();
    });
  }

  async function triggerSwitchAccount() {
    try {
      showToast("Opening account switch prompt...", "info");
      const newAddr = await fundMe.switchAccount();
      if (newAddr) {
        applyWalletConnectedUI({
          address: newAddr,
          chainId: fundMe.chainId,
          balance: await fundMe.getUserBalance(),
          walletType: fundMe.walletType,
          isSimulated: fundMe.isSimulated,
        });
        const donorAddrEl = document.getElementById("donateDonorAddr");
        if (donorAddrEl) donorAddrEl.textContent = formatAccount(newAddr);
        showToast(`Switched to: ${formatAccount(newAddr)}`, "success");
        if (onRefreshNeeded) await onRefreshNeeded();
      }
    } catch (err) {
      showToast(formatTxError(err), "error");
    }
  }

  if (switchAccountBtn) {
    switchAccountBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      triggerSwitchAccount();
    });
  }

  if (donateModalSwitchAccountBtn) {
    donateModalSwitchAccountBtn.addEventListener("click", triggerSwitchAccount);
  }

  if (contractConfigBtn) {
    contractConfigBtn.addEventListener("click", () => {
      if (contractAddressInput) contractAddressInput.value = fundMe.contractAddress || "";
      openModal(configModal);
    });
  }

  if (configForm) {
    configForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const addr = contractAddressInput.value.trim();
      if (!window.ethers.isAddress(addr)) {
        showToast("Invalid Ethereum address format", "error");
        return;
      }
      const knownWrong = [
        "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0", // MockERC20
        "0xdc64a140aa3e981100a9beca4e685f962f0cf6c9", // MockV3Aggregator
      ];
      if (knownWrong.includes(addr.toLowerCase())) {
        showToast("⚠️ Invalid address: FundMePlatform contract required, not MockERC20 or PriceFeed.", "error");
        return;
      }
      fundMe.setContractAddress(addr);
      closeModal(configModal);
      showToast("Contract address updated!", "success");
      if (onRefreshNeeded) await onRefreshNeeded();
    });
  }

  async function tryAutoReconnect() {
    const lastWallet = localStorage.getItem("fundme_last_wallet");
    if (lastWallet === "Coinbase") {
      const raw = fundMe.getCoinbaseProvider();
      if (raw) {
        try {
          const accounts = await raw.request({ method: "eth_accounts" });
          if (accounts && accounts.length > 0) {
            const res = await fundMe.connectCoinbase();
            applyWalletConnectedUI(res);
            if (onRefreshNeeded) await onRefreshNeeded();
          }
        } catch (_) {}
      }
    } else if (lastWallet === "MetaMask") {
      const raw = fundMe.getMetaMaskProvider();
      if (raw) {
        try {
          const accounts = await raw.request({ method: "eth_accounts" });
          if (accounts && accounts.length > 0) {
            const res = await fundMe.connectMetaMask();
            applyWalletConnectedUI(res);
            if (onRefreshNeeded) await onRefreshNeeded();
          }
        } catch (_) {}
      }
    } else if (lastWallet === "simulated") {
      try {
        const res = await fundMe.connectSimulated();
        applyWalletConnectedUI(res);
      } catch (_) {}
    }
  }

  tryAutoReconnect();

  return {
    applyWalletConnectedUI,
    applyWalletDisconnectedUI,
    triggerSwitchAccount,
    triggerSwitchToLocalhost,
  };
}
