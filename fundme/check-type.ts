import { network } from "hardhat";

async function main() {
    const { viem } = await network.create();
    const platform = await viem.deployContract("FundMePlatform", ["0x0", "0x0"]);
    platform.write;
}
