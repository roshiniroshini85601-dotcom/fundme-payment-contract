import { FundMeService } from "./src/contractService.js";
import {
  formatAccount,
  showToast,
  formatTxError,
  openModal,
  closeModal,
  copyToClipboard,
  initWalletUI,
} from "./wallet.js";

const fundMe = new FundMeService();

// State
let currentFilter = "all";
let campaignsList = [];
let activeDonateCampaign = null;
let activeWithdrawCampaign = null;
let activeRefundCampaign = null;
let ethPriceUSD = 2500;
let searchQuery = "";
let currentSort = "newest";
let activeTxTab = "all";
let allTransactionsList = [];

// DOM Elements
const $ = (id) => document.getElementById(id);
const campaignsGrid = $("campaignsGrid");
const statActiveCampaigns = $("statActiveCampaigns");
const statTotalRaised = $("statTotalRaised");
const statEthPrice = $("statEthPrice");
const campaignSearchInput = $("campaignSearchInput");
const clearSearchBtn = $("clearSearchBtn");
const campaignSortSelect = $("campaignSortSelect");

// Modals
const txHistoryModal = $("txHistoryModal");
const txCountBadge = $("txCountBadge");
const txListContainer = $("txListContainer");
const txTypeFilter = $("txTypeFilter");
const txSummaryText = $("txSummaryText");

const adminKycModal = $("adminKycModal");
const adminKycForm = $("adminKycForm");
const kycTargetAddress = $("kycTargetAddress");
const kycStatusResult = $("kycStatusResult");
const kycCreatorQuickSelect = $("kycCreatorQuickSelect");
const verifyKycSubmitBtn = $("verifyKycSubmitBtn");
const revokeKycBtn = $("revokeKycBtn");

const createModal = $("createModal");
const createCampaignForm = $("createCampaignForm");
const tokenTypeSelect = $("tokenTypeSelect");
const erc20AddressGroup = $("erc20AddressGroup");

const donateModal = $("donateModal");
const donateForm = $("donateForm");
const donateAmountInput = $("donateAmountInput");
const donateUsdEquivalent = $("donateUsdEquivalent");

const withdrawModal = $("withdrawModal");
const claimRefundModal = $("claimRefundModal");
const batchRefundModal = $("batchRefundModal");
const batchCampaignIdInput = $("batchCampaignIdInput");
const batchDonorsInput = $("batchDonorsInput");
const batchDonorsHelper = $("batchDonorsHelper");
const batchCountBadge = $("batchCountBadge");

function getCampaignMetadata(id) {
  try {
    const all = JSON.parse(localStorage.getItem("fundme_campaign_metadata") || "{}");
    if (all[id]) return all[id];
  } catch (_) {}
  return {
    title: `Campaign #${id}`,
    category: "General",
    desc: "A decentralized funding campaign on Ethereum."
  };
}

function saveCampaignMetadata(id, meta) {
  try {
    const all = JSON.parse(localStorage.getItem("fundme_campaign_metadata") || "{}");
    all[id] = meta;
    localStorage.setItem("fundme_campaign_metadata", JSON.stringify(all));
  } catch (_) {}
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return "Just now";
  const diff = Math.floor(Date.now() / 1000) - timestamp;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(timestamp * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function updateDonateUsdEquivalent() {
  if (!donateAmountInput || !donateUsdEquivalent) return;
  const amt = parseFloat(donateAmountInput.value) || 0;
  donateUsdEquivalent.textContent = `≈ ${(amt * ethPriceUSD).toLocaleString("en-US", { style: "currency", currency: "USD" })}`;
}

// Preset Buttons Delegated Listener
document.addEventListener("click", (e) => {
  const goalBtn = e.target.closest("[data-goal]");
  if (goalBtn) {
    const inp = $("targetGoalInput");
    if (inp) inp.value = goalBtn.dataset.goal;
    return;
  }
  const donateBtn = e.target.closest("[data-donate]");
  if (donateBtn) {
    donateAmountInput.value = (parseFloat(donateAmountInput.value || 0) + parseFloat(donateBtn.dataset.donate)).toFixed(3);
    updateDonateUsdEquivalent();
    return;
  }
  const durBtn = e.target.closest("[data-duration]");
  if (durBtn) {
    const durInp = $("durationInput");
    if (durInp) durInp.value = durBtn.dataset.duration;
    const unitSelect = $("durationUnitSelect");
    if (unitSelect && durBtn.dataset.unit) unitSelect.value = durBtn.dataset.unit;
  }
});

// Create Campaign
$("openCreateModalBtn")?.addEventListener("click", () => {
  if (!fundMe.userAddress) return showToast("Please connect your wallet first", "info");
  openModal(createModal);
});

tokenTypeSelect?.addEventListener("change", (e) => {
  const isErc = e.target.value === "erc20";
  if (erc20AddressGroup) erc20AddressGroup.style.display = isErc ? "block" : "none";
  const inp = $("tokenAddressInput") || $("erc20AddressInput");
  if (isErc && inp && !inp.value.trim()) {
    inp.value = fundMe.getDefaultTokenAddress();
  }
});

$("useDefaultTokenBtn")?.addEventListener("click", () => {
  const inp = $("tokenAddressInput") || $("erc20AddressInput");
  if (inp) {
    inp.value = fundMe.getDefaultTokenAddress();
    showToast("Filled default test token address!", "success");
  }
});

$("quickOpenMintFromCreate")?.addEventListener("click", () => {
  openMintTokenModal();
});

createCampaignForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const submitBtn = $("submitCreateBtn");
  try {
    submitBtn.disabled = true;
    submitBtn.textContent = "Deploying Campaign...";

    const title = $("campaignTitleInput")?.value.trim() || "New Campaign";
    const category = $("campaignCategorySelect")?.value || "Charity";
    const desc = $("campaignDescInput")?.value.trim() || "Decentralized Crowdfunding Campaign";

    const isToken = tokenTypeSelect?.value === "erc20";
    const rawToken = ($("tokenAddressInput")?.value || $("erc20AddressInput")?.value || "").trim();
    const tokenAddr = isToken ? (rawToken || fundMe.getDefaultTokenAddress()) : "0x0000000000000000000000000000000000000000";
    const goal = $("targetGoalInput").value;
    const durationVal = parseInt($("durationInput").value, 10);
    const durationUnit = $("durationUnitSelect")?.value || "days";

    const mults = { minutes: 60, hours: 3600, days: 86400 };
    const durationSeconds = durationVal * (mults[durationUnit] || 86400);
    const isFlexible = $("campaignTypeSelect")?.value === "flexible";

    showToast("Submitting campaign to blockchain...", "info");
    await fundMe.createCampaign(tokenAddr, goal, durationSeconds, isFlexible, true);

    const newId = campaignsList.length;
    saveCampaignMetadata(newId, { title, category, desc });

    if (fundMe.isSimulated) {
      campaignsList.unshift({
        id: newId,
        creator: fundMe.userAddress || "0xSimulatedCreator",
        isKycVerified: fundMe.userAddress?.toLowerCase() === "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
        tokenAddress: tokenAddr,
        isNative: !isToken,
        deadline: Math.floor(Date.now() / 1000) + durationSeconds,
        isCompleted: false,
        isFlexible,
        exists: true,
        targetGoal: parseFloat(goal).toFixed(2),
        totalRaised: "0.00",
        progressPercent: 0,
        isExpired: false,
        donors: []
      });
      renderCampaigns();
    }

    showToast(" Campaign successfully created!", "success");
    closeModal(createModal);
    createCampaignForm.reset();
    await updateTxHistoryCount();
    if (!fundMe.isSimulated) await refreshData();
  } catch (err) {
    showToast(formatTxError(err), "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Launch Campaign";
  }
});

// Donate Modal
donateAmountInput?.addEventListener("input", updateDonateUsdEquivalent);

function openDonateModal(c) {
  if (!fundMe.userAddress) return showToast("Please connect your wallet first", "info");
  activeDonateCampaign = c;
  if ($("donateModalCampaignId")) $("donateModalCampaignId").textContent = c.id;
  if ($("donateModalCreator")) $("donateModalCreator").textContent = formatAccount(c.creator);
  if ($("donateModalRemaining")) {
    const rem = Math.max(0, parseFloat(c.targetGoal) - parseFloat(c.totalRaised));
    $("donateModalRemaining").textContent = `${rem.toFixed(3)} ${c.isNative ? "ETH" : "Tokens"}`;
  }
  if ($("donateTokenSymbol")) $("donateTokenSymbol").textContent = c.isNative ? "ETH" : "Tokens";
  if ($("donateDonorAddr")) $("donateDonorAddr").textContent = formatAccount(fundMe.userAddress);
  if (donateAmountInput) donateAmountInput.value = "";
  updateDonateUsdEquivalent();

  if (!c.isNative && fundMe.userAddress) {
    fundMe.getTokenDetails(c.tokenAddress, fundMe.userAddress).then(details => {
      if (details && $("donateUsdEquivalent")) {
        $("donateUsdEquivalent").innerHTML = `<span>Your Balance: <strong style="color: #34d399;">${parseFloat(details.balance).toFixed(2)} ${details.symbol}</strong></span>`;
      }
    });
  }

  openModal(donateModal);
}

donateForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!activeDonateCampaign) return;
  const submitBtn = $("submitDonateBtn");
  const amt = donateAmountInput.value;
  const num = parseFloat(amt);
  if (isNaN(num) || num < 0.0001) {
    return showToast("Minimum contribution is 0.0001 " + (activeDonateCampaign.isNative ? "ETH" : "Tokens"), "error");
  }
  if (num > 1000) {
    return showToast("Maximum contribution is 1,000 " + (activeDonateCampaign.isNative ? "ETH" : "Tokens"), "error");
  }
  const cid = activeDonateCampaign.id;

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = "Processing Donation...";
    showToast(`Confirming donation of ${amt} ${activeDonateCampaign.isNative ? "ETH" : "Tokens"}...`, "info");

    if (activeDonateCampaign.isNative) {
      await fundMe.contributeETH(cid, amt);
    } else {
      await fundMe.contributeToken(cid, activeDonateCampaign.tokenAddress, amt);
    }

    if (fundMe.isSimulated) {
      const camp = campaignsList.find((c) => c.id === cid);
      if (camp) {
        const newRaised = (parseFloat(camp.totalRaised) + parseFloat(amt)).toFixed(3);
        camp.totalRaised = newRaised;
        camp.progressPercent = Math.min(100, Math.round((parseFloat(newRaised) / (parseFloat(camp.targetGoal) || 1)) * 100));
        camp.donors = camp.donors || [];
        camp.donors.push({ donor: fundMe.userAddress, amount: amt });
      }
      renderCampaigns();
    }

    showToast(` Successfully contributed ${amt} ${activeDonateCampaign.isNative ? "ETH" : "Tokens"} to Campaign #${cid}!`, "success");
    closeModal(donateModal);
    await updateTxHistoryCount();
    if (!fundMe.isSimulated) await refreshData();
  } catch (err) {
    showToast(formatTxError(err), "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Confirm Contribution";
  }
});

// Withdraw Modal
function openWithdrawModal(c) {
  if (!fundMe.userAddress) return showToast("Please connect your creator wallet first", "info");
  activeWithdrawCampaign = c;
  $("withdrawModalCampaignId").textContent = c.id;
  const unit = c.isNative ? "ETH" : "Tokens";
  const raised = parseFloat(c.totalRaised) || 0;
  const isKyc = !!c.isKycVerified;
  const feePct = isKyc ? 1 : 5;
  const feeAmount = (raised * feePct) / 100;

  $("withdrawTotalRaised").textContent = `${raised.toFixed(3)} ${unit}`;
  $("withdrawFeePercent").textContent = isKyc ? "1% (KYC Discounted)" : "5% (Standard)";
  $("withdrawFeeAmount").textContent = `-${feeAmount.toFixed(3)} ${unit}`;
  $("withdrawPayoutAmount").textContent = `${Math.max(0, raised - feeAmount).toFixed(3)} ${unit}`;
  $("withdrawCreatorAddr").textContent = formatAccount(fundMe.userAddress);
  openModal(withdrawModal);
}

$("confirmWithdrawBtn")?.addEventListener("click", async () => {
  if (!activeWithdrawCampaign) return;
  const btn = $("confirmWithdrawBtn");
  const cid = activeWithdrawCampaign.id;
  try {
    btn.disabled = true;
    btn.textContent = "Processing Withdrawal...";
    showToast(`Submitting withdrawal for campaign #${cid}...`, "info");
    await fundMe.withdrawFunds(cid);

    if (fundMe.isSimulated) {
      const camp = campaignsList.find((c) => c.id === cid);
      if (camp) camp.isCompleted = true;
      renderCampaigns();
    }
    showToast("Funds successfully withdrawn to your wallet!", "success");
    closeModal(withdrawModal);
    if (!fundMe.isSimulated) await refreshData();
  } catch (err) {
    showToast(formatTxError(err), "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Execute Withdrawal";
  }
});

// Claim Refund Modal
async function openClaimRefundModal(c) {
  if (!fundMe.userAddress) return showToast("Please connect your wallet to claim your refund", "info");
  activeRefundCampaign = c;
  $("refundModalCampaignId").textContent = c.id;
  $("refundDonorAddr").textContent = formatAccount(fundMe.userAddress);

  const unit = c.isNative ? "ETH" : "Tokens";
  let refundAmt = "0.00";

  if (!fundMe.isSimulated && fundMe.contract) {
    try {
      const contrib = await fundMe.getUserContribution(c.id, fundMe.userAddress);
      refundAmt = parseFloat(contrib.formatted).toFixed(3);
    } catch (_) {}
  }

  if (parseFloat(refundAmt) <= 0 && c.donors) {
    const userDonor = c.donors.find((d) => d.donor.toLowerCase() === fundMe.userAddress.toLowerCase());
    if (userDonor) refundAmt = parseFloat(userDonor.amount).toFixed(3);
  }

  const hasContrib = parseFloat(refundAmt) > 0;
  $("refundUserContribution").textContent = `${refundAmt} ${unit}`;
  $("refundUserRefundAmount").textContent = `${refundAmt} ${unit}`;

  const btn = $("confirmClaimRefundBtn");
  if (btn) {
    btn.disabled = !hasContrib;
    btn.textContent = hasContrib ? "Claim 100% Refund" : "No Contribution Found";
    btn.style.opacity = hasContrib ? "1" : "0.6";
    btn.style.cursor = hasContrib ? "pointer" : "not-allowed";
  }
  openModal(claimRefundModal);
}

$("confirmClaimRefundBtn")?.addEventListener("click", async () => {
  if (!activeRefundCampaign) return;
  const btn = $("confirmClaimRefundBtn");
  const cid = activeRefundCampaign.id;
  try {
    btn.disabled = true;
    btn.textContent = "Processing Refund...";
    showToast(`Claiming 100% refund for Campaign #${cid}...`, "info");
    await fundMe.claimRefund(cid);

    if (fundMe.isSimulated && activeRefundCampaign.donors) {
      activeRefundCampaign.donors = activeRefundCampaign.donors.filter(
        (d) => d.donor.toLowerCase() !== fundMe.userAddress.toLowerCase()
      );
      renderCampaigns();
    }
    showToast(" 100% refund returned to your wallet!", "success");
    closeModal(claimRefundModal);
    if (!fundMe.isSimulated) await refreshData();
  } catch (err) {
    showToast(formatTxError(err), "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Claim 100% Refund";
  }
});

// Batch Refund
async function populateBatchRefundDonors(cid) {
  if (cid === undefined || cid === null || isNaN(cid)) return;
  if (batchDonorsHelper) {
    batchDonorsHelper.textContent = "Fetching contributors on-chain...";
    batchDonorsHelper.style.color = "#94a3b8";
  }

  let donors = [];
  const camp = campaignsList.find((c) => c.id === cid);
  if (camp?.donors?.length) {
    donors = camp.donors;
  } else if (!fundMe.isSimulated) {
    try {
      donors = await fundMe.getCampaignDonors(cid);
    } catch (_) {}
  }

  if (donors.length > 0) {
    batchDonorsInput.value = donors.map((d) => d.donor).join(",\n");
    if (batchCountBadge) batchCountBadge.textContent = `${donors.length} donor${donors.length > 1 ? "s" : ""} found`;
    const summary = donors.map((d) => `${formatAccount(d.donor)} (${parseFloat(d.amount).toFixed(3)} ETH)`).join(", ");
    if (batchDonorsHelper) {
      batchDonorsHelper.innerHTML = `<span style="color: #34d399; font-weight: 600;"> Found ${donors.length} contributor(s):</span> ${summary}`;
    }
    showToast(`Auto-filled ${donors.length} donor address(es) for Campaign #${cid}!`, "success");
  } else {
    batchDonorsInput.value = "";
    if (batchCountBadge) batchCountBadge.textContent = "0 donors";
    if (batchDonorsHelper) {
      batchDonorsHelper.innerHTML = `<span style="color: #f87171;">Warning: No contributions recorded for Campaign #${cid}</span>`;
    }
  }
}

function openBatchRefundModalForCampaign(c) {
  if (!fundMe.userAddress) return showToast("Please connect your wallet first", "info");
  if (batchCampaignIdInput) batchCampaignIdInput.value = c.id;
  populateBatchRefundDonors(c.id);
  openModal(batchRefundModal);
}

$("batchRefundOpenBtn")?.addEventListener("click", () => {
  if (!fundMe.userAddress) return showToast("Please connect your wallet first", "info");
  const cid = parseInt(batchCampaignIdInput?.value, 10);
  if (!isNaN(cid)) populateBatchRefundDonors(cid);
  openModal(batchRefundModal);
});

$("batchAutoFetchBtn")?.addEventListener("click", () => {
  const cid = parseInt(batchCampaignIdInput?.value, 10);
  if (isNaN(cid)) return showToast("Please enter a valid Campaign ID first", "info");
  populateBatchRefundDonors(cid);
});

batchCampaignIdInput?.addEventListener("change", () => {
  const cid = parseInt(batchCampaignIdInput.value, 10);
  if (!isNaN(cid)) populateBatchRefundDonors(cid);
});

$("batchRefundForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const submitBtn = $("submitBatchRefundBtn");
  try {
    submitBtn.disabled = true;
    submitBtn.textContent = "Processing batch...";

    const cid = parseInt(batchCampaignIdInput.value, 10);
    const donors = (batchDonorsInput?.value || "")
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter((s) => window.ethers.isAddress(s));

    if (donors.length === 0) return showToast("No valid donor addresses provided", "error");

    showToast(`Processing batch refund for ${donors.length} donors...`, "info");
    await fundMe.batchRefund(cid, donors);
    showToast(` Successfully processed batch refund for ${donors.length} donors!`, "success");
    closeModal(batchRefundModal);
    $("batchRefundForm").reset();
    if (batchDonorsHelper) batchDonorsHelper.textContent = "";
    if (batchCountBadge) batchCountBadge.textContent = "";
    await refreshData();
  } catch (err) {
    showToast(formatTxError(err), "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Execute Batch Refund";
  }
});

// Search, Sort & Filters
document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    currentFilter = chip.dataset.filter;
    renderCampaigns();
  });
});

campaignSearchInput?.addEventListener("input", (e) => {
  searchQuery = e.target.value.trim();
  if (clearSearchBtn) clearSearchBtn.style.display = searchQuery ? "block" : "none";
  renderCampaigns();
});

clearSearchBtn?.addEventListener("click", () => {
  campaignSearchInput.value = "";
  searchQuery = "";
  clearSearchBtn.style.display = "none";
  renderCampaigns();
});

campaignSortSelect?.addEventListener("change", (e) => {
  currentSort = e.target.value;
  renderCampaigns();
});

// Campaigns Grid Event Delegation (Single Delegated Click Handler for all cards!)
campaignsGrid?.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const copyAddr = btn.dataset.address;
  if (btn.classList.contains("btn-copy-donor") && copyAddr) {
    e.stopPropagation();
    return copyToClipboard(copyAddr, `Copied ${formatAccount(copyAddr)}!`);
  }

  const cid = parseInt(btn.dataset.id ?? btn.dataset.cid, 10);
  const camp = campaignsList.find((c) => c.id === cid);

  if (btn.classList.contains("donate-btn") && camp) return openDonateModal(camp);
  if (btn.classList.contains("withdraw-btn") && camp) return openWithdrawModal(camp);
  if (btn.classList.contains("refund-btn") && camp) return openClaimRefundModal(camp);
  if (btn.classList.contains("batch-refund-card-btn") && camp) return openBatchRefundModalForCampaign(camp);

  if (btn.classList.contains("btn-copy-all-donors") && camp?.donors?.length) {
    const list = camp.donors.map((d) => d.donor).join(",\n");
    return copyToClipboard(list, `Copied ${camp.donors.length} donor address(es) for Campaign #${camp.id}!`);
  }

  if (btn.classList.contains("freeze-btn")) {
    const isCurrentlyFrozen = btn.getAttribute("data-frozen") === "true";
    const actionText = isCurrentlyFrozen ? "unfreeze" : "freeze";
    if (!confirm(`Are you sure you want to ${actionText} Campaign #${cid}?`)) return;
    try {
      btn.disabled = true;
      btn.textContent = isCurrentlyFrozen ? "Unfreezing..." : "Freezing...";
      showToast(`${isCurrentlyFrozen ? "Unfreezing" : "Freezing"} Campaign #${cid}...`, "info");
      await fundMe.setCampaignFrozen(cid, !isCurrentlyFrozen);
      showToast(`Campaign #${cid} ${isCurrentlyFrozen ? "unfrozen" : "frozen"} successfully!`, "success");
      await refreshData();
    } catch (err) {
      showToast(formatTxError(err), "error");
      btn.disabled = false;
      btn.textContent = isCurrentlyFrozen ? " Unfreeze" : " Freeze";
    }
    return;
  }

  if (btn.classList.contains("delete-btn")) {
    if (!confirm(`Are you sure you want to cancel and delete Campaign #${cid}?`)) return;
    try {
      btn.disabled = true;
      btn.textContent = "Deleting...";
      showToast(`Canceling Campaign #${cid}...`, "info");
      await fundMe.cancelCampaign(cid);

      if (fundMe.isSimulated) {
        campaignsList = campaignsList.filter((item) => item.id !== cid);
        renderCampaigns();
      }
      showToast(`Campaign #${cid} canceled/deleted successfully!`, "success");
      await updateTxHistoryCount();
      if (!fundMe.isSimulated) await refreshData();
    } catch (err) {
      showToast(formatTxError(err), "error");
      btn.disabled = false;
      btn.textContent = "Delete";
    }
  }
});

// Render Campaigns
function renderCampaigns() {
  campaignsGrid.innerHTML = "";
  const now = Date.now();

  const filtered = campaignsList.filter((c) => {
    const isPastDeadline = now >= c.deadline * 1000;
    const raisedNum = parseFloat(c.totalRaised) || 0;
    const goalNum = parseFloat(c.targetGoal) || 1;
    const isGoalMet = raisedNum >= (goalNum - 0.0001) || (c.progressPercent >= 99.9);
    const isCreator = fundMe.userAddress && fundMe.userAddress.toLowerCase() === c.creator.toLowerCase();
    const hasDonated = fundMe.userAddress && c.donors?.some((d) => d.donor.toLowerCase() === fundMe.userAddress.toLowerCase());

    if (currentFilter === "active") return !c.isCompleted && !isPastDeadline && !isGoalMet;
    if (currentFilter === "completed") return c.isCompleted || isGoalMet;
    if (currentFilter === "refundable") return !c.isFlexible && !c.isCompleted && isPastDeadline && !isGoalMet;
    if (currentFilter === "my-campaigns") return isCreator;
    if (currentFilter === "my-donations") return hasDonated;
    if (currentFilter === "kyc-verified") return !!c.isKycVerified;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const meta = getCampaignMetadata(c.id);
      const matches =
        c.id.toString().includes(q) ||
        c.creator.toLowerCase().includes(q) ||
        (meta.title && meta.title.toLowerCase().includes(q)) ||
        (meta.desc && meta.desc.toLowerCase().includes(q)) ||
        (meta.category && meta.category.toLowerCase().includes(q));
      if (!matches) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    if (currentSort === "endingSoon") return a.deadline - b.deadline;
    if (currentSort === "mostRaised") return parseFloat(b.totalRaised) - parseFloat(a.totalRaised);
    if (currentSort === "closestGoal") return b.progressPercent - a.progressPercent;
    return b.id - a.id;
  });

  if (filtered.length === 0) {
    campaignsGrid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon"></div>
        <h3>No Campaigns Found</h3>
        <p>No campaigns match your selected filter or search term. Create one to get started!</p>
      </div>
    `;
    return;
  }

  filtered.forEach((c) => {
    const card = document.createElement("div");
    card.className = "campaign-card";

    const meta = getCampaignMetadata(c.id);
    const isCreator = fundMe.userAddress && fundMe.userAddress.toLowerCase() === c.creator.toLowerCase();
    const isPastDeadline = now >= c.deadline * 1000;
    const raisedNum = parseFloat(c.totalRaised) || 0;
    const goalNum = parseFloat(c.targetGoal) || 1;
    const isGoalMet = raisedNum >= (goalNum - 0.0001) || (c.progressPercent >= 99.9);
    const canWithdraw = !c.isFrozen && isCreator && !c.isCompleted && (c.isFlexible ? raisedNum > 0 : isGoalMet);
    const isRefundable = !c.isCompleted && (c.isFrozen ? (userContrib && raisedNum > 0) : (!c.isFlexible && isPastDeadline && !isGoalMet));

    let timeText = "Ended";
    if (isGoalMet) {
      timeText = "Goal Reached";
    } else if (!isPastDeadline) {
      const diffMs = c.deadline * 1000 - now;
      const days = Math.floor(diffMs / 86400000);
      const hours = Math.floor((diffMs % 86400000) / 3600000);
      const mins = Math.floor((diffMs % 3600000) / 60000);
      timeText = days > 0 ? `${days}d ${hours}h left` : hours > 0 ? `${hours}h ${mins}m left` : `${Math.max(1, mins)}m left`;
    }

    const userContrib = fundMe.userAddress && c.donors?.find((d) => d.donor.toLowerCase() === fundMe.userAddress.toLowerCase());

    card.innerHTML = `
      <div>
        <div class="card-header">
          <div class="campaign-id">CAMPAIGN #${c.id}</div>
          <div class="badges-row">
            <span class="badge badge-category">${meta.category || "General"}</span>
            ${c.isKycVerified
              ? '<span class="badge badge-kyc-verified" title="Identity verified by platform admin - 1% fee rate">V KYC Verified</span>'
              : '<span class="badge badge-standard-creator" title="Standard unverified creator - 5% fee rate">Standard (5% Fee)</span>'
            }
            <span class="badge ${c.isFlexible ? "badge-flexible" : "badge-all-or-nothing"}">
              ${c.isFlexible ? "Flexible" : "All-or-Nothing"}
            </span>
            <span class="badge ${c.isCompleted ? "badge-status-completed" : isGoalMet ? "badge-status-reached" : isPastDeadline ? "badge-status-expired" : "badge-status-active"}">
              ${c.isCompleted ? "Completed" : isGoalMet ? "Goal Reached" : isPastDeadline ? "Ended" : "Active"}
            </span>
            ${c.isFrozen ? '<span class="badge" style="background: rgba(239, 68, 68, 0.25); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.5); font-weight: 600;"> FROZEN</span>' : ''}
            <span class="badge">${c.isNative ? "ETH" : "ERC20"}</span>
          </div>
        </div>

        <h3 class="campaign-card-title">${meta.title}</h3>
        <p class="campaign-card-desc">${meta.desc}</p>

        <div class="creator-info">
          <span>Creator:</span>
          <span class="creator-address" title="${c.creator}">
            ${formatAccount(c.creator)} ${isCreator ? "(You)" : ""}
          </span>
        </div>

        <div class="funding-progress">
          <div class="progress-labels">
            <div>
              <span class="raised-amount">${parseFloat(c.totalRaised).toFixed(3)}</span>
              <span style="color: var(--text-muted); font-size: 0.85rem;">${c.isNative ? "ETH" : "Tokens"}</span>
            </div>
            <div class="goal-amount">
              Goal: ${parseFloat(c.targetGoal).toFixed(2)} ${c.isNative ? "ETH" : ""} (${c.progressPercent}%)
            </div>
          </div>
          <div class="progress-bar-container">
            <div class="progress-bar-fill" style="width: ${c.progressPercent}%;"></div>
          </div>
        </div>

        <div class="donors-section">
          <div class="donors-header">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="donors-title">Contributors (${c.donors ? c.donors.length : 0})</span>
              ${c.donors?.length
                ? `<button type="button" class="btn-copy-all-donors" data-cid="${c.id}" title="Copy all donor addresses" style="background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.16); color: #cbd5e1; border-radius: 4px; padding: 2px 7px; font-size: 0.72rem; cursor: pointer;"> Copy All</button>`
                : ""
              }
            </div>
            ${userContrib ? `<span class="user-contrib-badge">You gave: ${parseFloat(userContrib.amount).toFixed(3)} ${c.isNative ? "ETH" : ""}</span>` : ""}
          </div>
          <div class="donors-list">
            ${c.donors?.length
              ? c.donors
                .slice(0, 4)
                .map(
                  (d) => `
                    <div class="donor-item">
                      <div style="display: flex; align-items: center; gap: 6px; overflow: hidden;">
                        <span class="donor-address" title="${d.donor}">
                          ${formatAccount(d.donor)}
                          ${fundMe.userAddress?.toLowerCase() === d.donor.toLowerCase() ? '<span class="you-badge">You</span>' : ""}
                        </span>
                        <button type="button" class="btn-copy-donor" data-address="${d.donor}" title="Copy address" style="background: transparent; border: none; color: #94a3b8; cursor: pointer; padding: 2px 4px; font-size: 0.8rem; line-height: 1;"></button>
                      </div>
                      <span class="donor-amount">${parseFloat(d.amount).toFixed(3)} ${c.isNative ? "ETH" : ""}</span>
                    </div>
                  `
                )
                .join("") + (c.donors.length > 4 ? `<div class="donors-more">+${c.donors.length - 4} more donors</div>` : "")
              : '<div class="no-donors-yet">No contributions yet. Be the first!</div>'
            }
          </div>
        </div>
      </div>

      <div class="card-footer">
        <div class="deadline-countdown">
          <span class="countdown-icon"></span>
          <span>${timeText}</span>
        </div>

        <div class="card-actions">
          ${c.isFrozen
            ? `<button class="btn btn-secondary btn-sm" disabled style="opacity: 0.7; color: #f87171; border-color: rgba(239, 68, 68, 0.4); cursor: not-allowed;"> Frozen</button>`
            : c.isCompleted
              ? `<button class="btn btn-secondary btn-sm" disabled style="opacity: 0.65; cursor: not-allowed;">Withdrawn & Closed</button>`
              : !isPastDeadline && !isGoalMet
                ? `<button class="btn btn-primary btn-sm donate-btn" data-id="${c.id}">Donate</button>`
                : isGoalMet && !canWithdraw
                  ? `<button class="btn btn-secondary btn-sm btn-goal-reached" disabled>Goal Reached</button>`
                  : ""
          }
          ${canWithdraw ? `<button class="btn btn-success btn-sm withdraw-btn" data-id="${c.id}">Withdraw</button>` : ""}
          ${isRefundable ? `<button class="btn btn-danger btn-sm refund-btn" data-id="${c.id}">Claim Refund</button>` : ""}
          ${c.donors?.length && !c.isCompleted && (isRefundable || isPastDeadline || !isGoalMet)
            ? `<button class="btn btn-secondary btn-sm batch-refund-card-btn" data-id="${c.id}" style="color: #f87171; border-color: rgba(239, 68, 68, 0.4); padding: 5px 8px;"> Batch Refund (${c.donors.length})</button>`
            : ""
          }
          ${isCreator && !c.isCompleted && !c.isFrozen
            ? `<button class="btn btn-secondary btn-sm delete-btn" data-id="${c.id}" style="color: #f87171; border-color: rgba(239, 68, 68, 0.35); padding: 5px 8px;">Delete</button>`
            : ""
          }
          <button class="btn btn-secondary btn-sm freeze-btn" data-id="${c.id}" data-frozen="${c.isFrozen ? "true" : "false"}" style="padding: 5px 8px; font-size: 0.75rem; border-color: ${c.isFrozen ? "rgba(34, 197, 94, 0.4)" : "rgba(239, 68, 68, 0.4)"}; color: ${c.isFrozen ? "#4ade80" : "#fca5a5"};" title="Admin/Reviewer toggle">${c.isFrozen ? " Unfreeze" : " Freeze"}</button>
        </div>
      </div>
    `;

    campaignsGrid.appendChild(card);
  });
}

// Transaction History

async function updateTxHistoryCount() {
  try {
    const txs = await fundMe.getAllTransactions();
    allTransactionsList = txs;
    if (txCountBadge) txCountBadge.textContent = txs.length;
  } catch (_) {}
}

async function loadTransactionHistory() {
  if (!txListContainer) return;
  txListContainer.innerHTML = `
    <div class="empty-state" style="padding: 30px 20px;">
      <div class="empty-state-icon"></div>
      <h3>Loading Transactions...</h3>
      <p>Reading on-chain event logs...</p>
    </div>
  `;

  try {
    const filterAddr = activeTxTab === "mine" ? fundMe.userAddress : null;
    const txs = await fundMe.getAllTransactions(filterAddr);
    allTransactionsList = txs;
    if (txCountBadge) txCountBadge.textContent = txs.length;

    const selectedType = txTypeFilter?.value || "all";
    const filteredTxs = txs.filter((t) => (selectedType === "all" ? true : t.type === selectedType));

    if (txSummaryText) {
      txSummaryText.textContent = `Showing ${filteredTxs.length} of ${txs.length} transaction${txs.length === 1 ? "" : "s"}`;
    }

    if (filteredTxs.length === 0) {
      txListContainer.innerHTML = `
        <div class="empty-state" style="padding: 40px 20px;">
          <div class="empty-state-icon"></div>
          <h3>No Transactions Found</h3>
          <p>${activeTxTab === "mine" ? "No transactions found for your connected wallet." : "No transactions match this filter."}</p>
        </div>
      `;
      return;
    }

    const typeIcons = { donation: "", withdrawal: "", refund: "", created: "", canceled: "", kyc: "️" };

    txListContainer.innerHTML = filteredTxs
      .map((t) => {
        const icon = typeIcons[t.type] || "";
        const isPos = t.type === "donation" || t.type === "created";
        const amtStr = t.amount && parseFloat(t.amount) > 0 ? `${t.type === "withdrawal" || t.type === "refund" ? "-" : "+"}${t.amount} ${t.token || "ETH"}` : "";
        const isYou = fundMe.userAddress && t.from && fundMe.userAddress.toLowerCase() === t.from.toLowerCase();

        return `
          <div class="tx-item tx-type-${t.type}">
            <div class="tx-item-left">
              <div class="tx-icon-badge">${icon}</div>
              <div class="tx-details">
                <div class="tx-title">
                  ${t.title}
                  ${t.campaignId !== undefined ? `<span style="color: #818cf8; font-size: 0.8rem; margin-left: 4px;">#${t.campaignId}</span>` : ""}
                </div>
                <div class="tx-meta">
                  <span>From: <strong title="${t.from || "Platform"}">${formatAccount(t.from || "Platform")}</strong>${isYou ? ' <span class="you-badge">You</span>' : ""}</span>
                  ${t.to ? `<span>→ To: <strong title="${t.to}">${formatAccount(t.to)}</strong></span>` : ""}
                  ${t.hash ? `
                    <span>•</span>
                    <a href="https://sepolia.etherscan.io/tx/${t.hash}" target="_blank" rel="noopener noreferrer" class="tx-hash-link" title="${t.hash}">
                      ${t.hash.slice(0, 8)}...${t.hash.slice(-6)} 
                    </a>
                    <button type="button" class="btn-copy-tx" data-hash="${t.hash}" title="Copy hash" style="background: transparent; border: none; color: #94a3b8; cursor: pointer; padding: 0 2px; font-size: 0.75rem;"></button>
                  ` : ""}
                </div>
              </div>
            </div>
            <div class="tx-item-right">
              ${amtStr ? `<div class="tx-amount ${isPos ? "tx-amount-positive" : "tx-amount-negative"}">${amtStr}</div>` : ""}
              <div class="tx-time" title="${t.timestamp ? new Date(t.timestamp * 1000).toLocaleString() : ""}">${formatRelativeTime(t.timestamp)}</div>
            </div>
          </div>
        `;
      })
      .join("");
  } catch (err) {
    txListContainer.innerHTML = `
      <div class="empty-state" style="padding: 30px 20px;">
        <div class="empty-state-icon">Warning:</div>
        <h3>Failed to load transactions</h3>
        <p>${err.message || "Could not query contract events"}</p>
      </div>
    `;
  }
}

// Transaction Modal Delegated Events
txListContainer?.addEventListener("click", (e) => {
  const btn = e.target.closest(".btn-copy-tx");
  if (btn?.dataset.hash) copyToClipboard(btn.dataset.hash, "Copied Transaction Hash!");
});

$("openTxHistoryBtn")?.addEventListener("click", () => {
  openModal(txHistoryModal);
  loadTransactionHistory();
});

document.querySelectorAll(".tx-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tx-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    activeTxTab = tab.dataset.txTab;
    loadTransactionHistory();
  });
});

txTypeFilter?.addEventListener("change", loadTransactionHistory);
$("refreshTxHistoryBtn")?.addEventListener("click", loadTransactionHistory);

// Admin KYC Handlers
function updateAdminKycModal() {
  if (!kycCreatorQuickSelect) return;
  kycCreatorQuickSelect.innerHTML = '<option value="">-- Choose from active campaign creators --</option>';
  const uniqueCreators = new Map();
  campaignsList.forEach((c) => {
    if (c.creator && !uniqueCreators.has(c.creator.toLowerCase())) {
      uniqueCreators.set(c.creator.toLowerCase(), { address: c.creator, campaignId: c.id, isKycVerified: c.isKycVerified });
    }
  });

  for (const item of uniqueCreators.values()) {
    const opt = document.createElement("option");
    opt.value = item.address;
    opt.textContent = `${formatAccount(item.address)} (Campaign #${item.campaignId}) — ${item.isKycVerified ? "V Verified" : "Unverified"}`;
    kycCreatorQuickSelect.appendChild(opt);
  }
}

$("openAdminKycBtn")?.addEventListener("click", () => {
  updateAdminKycModal();
  if (kycStatusResult) kycStatusResult.textContent = "";
  if (revokeKycBtn) revokeKycBtn.style.display = "none";
  openModal(adminKycModal);
});

kycCreatorQuickSelect?.addEventListener("change", (e) => {
  if (kycTargetAddress) {
    kycTargetAddress.value = e.target.value;
    if (e.target.value) checkKycAddressStatus(e.target.value);
  }
});

async function checkKycAddressStatus(addr) {
  if (!addr || !kycStatusResult) return;
  kycStatusResult.textContent = "Checking on-chain KYC status...";
  kycStatusResult.style.color = "#94a3b8";

  try {
    const isVerified = await fundMe.isKycVerified(addr);
    if (isVerified) {
      kycStatusResult.innerHTML = '<span style="color: #34d399;">V Address is KYC Verified (Eligible for 1% discounted fee)</span>';
      if (revokeKycBtn) revokeKycBtn.style.display = "inline-block";
    } else {
      kycStatusResult.innerHTML = '<span style="color: #f59e0b;">Warning: Address is Unverified (Standard 5% platform fee)</span>';
      if (revokeKycBtn) revokeKycBtn.style.display = "none";
    }
  } catch (err) {
    kycStatusResult.textContent = "Error checking status";
    kycStatusResult.style.color = "#f87171";
  }
}

$("kycCheckStatusBtn")?.addEventListener("click", () => {
  const addr = kycTargetAddress?.value.trim();
  if (!addr) return showToast("Please enter an address to check", "info");
  checkKycAddressStatus(addr);
});

adminKycForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const addr = kycTargetAddress?.value.trim();
  if (!addr) return;

  try {
    verifyKycSubmitBtn.disabled = true;
    verifyKycSubmitBtn.textContent = "Verifying on-chain...";
    showToast(`Granting KYC verified status to ${formatAccount(addr)}...`, "info");
    await fundMe.setKycStatus(addr, true);
    showToast(`V Successfully verified ${formatAccount(addr)}! (1% fee rate applied)`, "success");
    await checkKycAddressStatus(addr);
    await refreshData();
    await updateTxHistoryCount();
  } catch (err) {
    showToast(formatTxError(err), "error");
  } finally {
    verifyKycSubmitBtn.disabled = false;
    verifyKycSubmitBtn.textContent = "V Verify Creator (1% Fee)";
  }
});

revokeKycBtn?.addEventListener("click", async () => {
  const addr = kycTargetAddress?.value.trim();
  if (!addr) return;
  if (!confirm(`Are you sure you want to revoke KYC verification for ${addr}? They will be charged 5% fee.`)) return;

  try {
    revokeKycBtn.disabled = true;
    revokeKycBtn.textContent = "Revoking...";
    showToast(`Revoking KYC status for ${formatAccount(addr)}...`, "info");
    await fundMe.setKycStatus(addr, false);
    showToast(`KYC status revoked for ${formatAccount(addr)}. Standard 5% fee restored.`, "info");
    await checkKycAddressStatus(addr);
    await refreshData();
    await updateTxHistoryCount();
  } catch (err) {
    showToast(formatTxError(err), "error");
  } finally {
    revokeKycBtn.disabled = false;
    revokeKycBtn.textContent = "Revoke Verification";
  }
});

// Mint Token Modal
const mintTokenModal = $("mintTokenModal");
const mintTokenAddressInput = $("mintTokenAddressInput");
const mintRecipientInput = $("mintRecipientInput");
const mintTokenInfoLabel = $("mintTokenInfoLabel");
const mintCurrentBalanceLabel = $("mintCurrentBalanceLabel");
const mintAmountInput = $("mintAmountInput");
const mintTokenForm = $("mintTokenForm");
const submitMintBtn = $("submitMintBtn");

async function updateMintTokenDetails(addr) {
  if (!addr || !window.ethers.isAddress(addr)) {
    if (mintTokenInfoLabel) mintTokenInfoLabel.textContent = "Invalid token contract address";
    if (mintCurrentBalanceLabel) mintCurrentBalanceLabel.textContent = "—";
    return;
  }
  if (mintTokenInfoLabel) mintTokenInfoLabel.textContent = "Loading token details...";
  try {
    const details = await fundMe.getTokenDetails(addr, fundMe.userAddress);
    if (details) {
      if (mintTokenInfoLabel) mintTokenInfoLabel.textContent = `${details.name} (${details.symbol}) — ${details.decimals} decimals`;
      if (mintCurrentBalanceLabel) mintCurrentBalanceLabel.textContent = `${parseFloat(details.balance).toFixed(2)} ${details.symbol}`;
      fundMe.setDefaultTokenAddress(addr);
    } else {
      if (mintTokenInfoLabel) mintTokenInfoLabel.textContent = "Mock token (mintable)";
      if (mintCurrentBalanceLabel) mintCurrentBalanceLabel.textContent = "0.00";
    }
  } catch (_) {
    if (mintTokenInfoLabel) mintTokenInfoLabel.textContent = "Test ERC-20 Token";
  }
}

function openMintTokenModal() {
  if (!fundMe.userAddress) return showToast("Please connect your wallet first", "info");
  if (mintRecipientInput) mintRecipientInput.value = fundMe.userAddress;
  const defaultToken = fundMe.getDefaultTokenAddress();
  if (mintTokenAddressInput) mintTokenAddressInput.value = defaultToken;
  updateMintTokenDetails(defaultToken);
  openModal(mintTokenModal);
}

$("openMintTokenBtn")?.addEventListener("click", openMintTokenModal);

mintTokenAddressInput?.addEventListener("change", (e) => {
  updateMintTokenDetails(e.target.value.trim());
});

$("resetDefaultMintTokenBtn")?.addEventListener("click", () => {
  const def = "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853";
  fundMe.setDefaultTokenAddress(def);
  if (mintTokenAddressInput) mintTokenAddressInput.value = def;
  updateMintTokenDetails(def);
});

document.querySelectorAll("[data-mint-amt]").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (mintAmountInput) mintAmountInput.value = btn.getAttribute("data-mint-amt");
  });
});

$("addTokenToMetaMaskBtn")?.addEventListener("click", async () => {
  const addr = mintTokenAddressInput?.value.trim();
  if (!addr) return showToast("Please enter a token address first", "info");
  try {
    await fundMe.addTokenToWallet(addr);
    showToast("Token add request sent to your wallet!", "success");
  } catch (err) {
    showToast(err.message || "Failed to add token to wallet", "error");
  }
});

mintTokenForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const tokenAddr = mintTokenAddressInput?.value.trim();
  const amt = mintAmountInput?.value.trim();
  if (!tokenAddr || !amt) return;

  try {
    if (submitMintBtn) {
      submitMintBtn.disabled = true;
      submitMintBtn.textContent = "Minting Tokens...";
    }
    showToast(`Minting ${amt} test tokens to ${formatAccount(fundMe.userAddress)}...`, "info");
    await fundMe.mintTokens(tokenAddr, amt);
    showToast(` Successfully minted ${amt} test tokens!`, "success");
    await updateMintTokenDetails(tokenAddr);
    await updateTxHistoryCount();
  } catch (err) {
    showToast(formatTxError(err), "error");
  } finally {
    if (submitMintBtn) {
      submitMintBtn.disabled = false;
      submitMintBtn.textContent = " Mint Tokens";
    }
  }
});

// Data Refresh
async function refreshData() {
  if (!fundMe.contractAddress) {
    campaignsList = [];
    if (statActiveCampaigns) statActiveCampaigns.textContent = "0";
    if (statTotalRaised) statTotalRaised.textContent = "0.00 ETH";
    renderCampaigns();
    await updateTxHistoryCount();
    return;
  }

  try {
    campaignsList = await fundMe.getAllCampaigns();
    ethPriceUSD = await fundMe.getLatestETHPrice();

    if (statEthPrice) statEthPrice.textContent = `$${ethPriceUSD.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    if (statActiveCampaigns) {
      statActiveCampaigns.textContent = campaignsList.filter(
        (c) => !c.isCompleted && Date.now() < c.deadline * 1000 && parseFloat(c.totalRaised) < parseFloat(c.targetGoal)
      ).length;
    }

    const totalEth = campaignsList
      .filter((c) => c.isNative)
      .reduce((acc, c) => acc + parseFloat(c.totalRaised), 0);
    if (statTotalRaised) statTotalRaised.textContent = `${totalEth.toFixed(2)} ETH`;

    renderCampaigns();
    await updateTxHistoryCount();
  } catch (_) {}
}

window.addEventListener("DOMContentLoaded", async () => {
  initWalletUI(fundMe, refreshData);
  await refreshData();
  await updateTxHistoryCount();
});
