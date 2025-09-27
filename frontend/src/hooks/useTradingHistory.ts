import { useCallback, useState } from "react";
import { useAccount } from "wagmi";
import { readContract, getPublicClient } from "@wagmi/core";
import { config } from "@/configs";
import { MARKET_ABIS } from "@/lib/marketABIs";
import { decodeEventLog } from "viem";
import type { Market } from "@/types/market";

interface TradeRecord {
  id: string;
  marketAddress: string;
  outcomeIndex: number;
  outcome: string;
  shares: number;
  costBasis: number; // Total amount paid (including fees)
  timestamp: number;
  txHash: string;
}

interface PositionSummary {
  outcomeIndex: number;
  outcome: string;
  totalShares: number;
  totalCostBasis: number;
  currentTokenBalance: number;
  avgCostPerShare: number;
  currentValue: number;
  unrealizedPnL: number; // Profit/Loss
}

interface TradingHistoryData {
  positions: PositionSummary[];
  totalCostBasis: number;
  totalCurrentValue: number;
  totalUnrealizedPnL: number;
}

export function useTradingHistory() {
  const { address } = useAccount();
  const [historyState, setHistoryState] = useState<{
    isLoading: boolean;
    error: string | null;
    data: TradingHistoryData | null;
  }>({
    isLoading: false,
    error: null,
    data: null,
  });

  // Get trading history from smart contract events
  const getTradingHistory = useCallback(
    async (market: Market): Promise<TradeRecord[]> => {
      if (!address || !market.address) return [];

      try {
        // Get Bought events for this user and market
        const publicClient = getPublicClient(config);
        if (!publicClient) throw new Error("Public client not available");

        const logs = await publicClient.getLogs({
          address: market.address as `0x${string}`,
          event: {
            type: "event",
            name: "Bought",
            inputs: [
              { indexed: true, name: "user", type: "address" },
              { indexed: false, name: "token", type: "address" },
              { indexed: false, name: "shares", type: "uint256" },
              { indexed: false, name: "cost", type: "uint256" },
              { indexed: false, name: "fee", type: "uint256" },
            ],
          },
          args: { user: address },
          fromBlock: 0n,
          toBlock: "latest",
        });

        // Parse the event logs
        const events = logs.map((log: unknown) => {
          const decoded = decodeEventLog({
            abi: MARKET_ABIS[
              `${market.type}Market` as keyof typeof MARKET_ABIS
            ],
            data: (log as { data: `0x${string}` }).data,
            topics: (log as { topics: `0x${string}`[] }).topics as [
              signature: `0x${string}`,
              ...args: `0x${string}`[]
            ],
          });
          return {
            args: decoded.args,
            blockNumber: (log as { blockNumber: bigint }).blockNumber,
            logIndex: (log as { logIndex: number }).logIndex,
            transactionHash: (log as { transactionHash: `0x${string}` })
              .transactionHash,
          };
        });

        // Get token addresses for outcome mapping
        let yesTokenAddress: string | undefined;
        let noTokenAddress: string | undefined;

        if (market.type === "binary") {
          try {
            [yesTokenAddress, noTokenAddress] = await Promise.all([
              readContract(config, {
                address: market.address as `0x${string}`,
                abi: MARKET_ABIS.binaryMarket,
                functionName: "yesToken",
              }) as Promise<string>,
              readContract(config, {
                address: market.address as `0x${string}`,
                abi: MARKET_ABIS.binaryMarket,
                functionName: "noToken",
              }) as Promise<string>,
            ]);
          } catch (error) {
            console.error("Error fetching token addresses:", error);
          }
        }

        // Convert events to TradeRecord format
        const trades: TradeRecord[] = events.map((event: unknown) => {
          const { user: _user, token, shares, cost, fee } = (
            event as {
              args: {
                user: string;
                token: string;
                shares: bigint;
                cost: bigint;
                fee: bigint;
              };
            }
          ).args;

          // Determine outcome index based on token address
          let outcomeIndex = 0;
          let outcome = "Unknown";

          if (market.type === "binary" && yesTokenAddress && noTokenAddress) {
            if (token.toLowerCase() === yesTokenAddress.toLowerCase()) {
              outcomeIndex = 0;
              outcome = "Yes";
            } else if (token.toLowerCase() === noTokenAddress.toLowerCase()) {
              outcomeIndex = 1;
              outcome = "No";
            }
          }

          return {
            id: `${market.address}_${outcomeIndex}_${
              (event as { blockNumber: bigint }).blockNumber
            }_${(event as { logIndex: number }).logIndex}`,
            marketAddress: market.address!,
            outcomeIndex,
            outcome,
            shares: Number(shares) / 1e18,
            costBasis: (Number(cost) + Number(fee)) / 1e18,
            timestamp:
              Number((event as { blockNumber: bigint }).blockNumber) * 1000, // Approximate timestamp
            txHash: (event as { transactionHash: `0x${string}` })
              .transactionHash,
          };
        });

        return trades;
      } catch (error) {
        console.error("Error fetching trading history from contract:", error);
        return [];
      }
    },
    [address]
  );

  // No longer needed - trades are fetched from contract
  const addTrade = useCallback(() => {
    // This function is no longer needed since we fetch from contract
    console.log(
      "addTrade called but trades are now fetched from contract events"
    );
  }, []);

  // Get current token balances for a market
  const getCurrentBalances = useCallback(
    async (
      market: Market
    ): Promise<{ outcomeIndex: number; balance: number }[]> => {
      if (!address || !market.address) return [];

      try {
        const balances: { outcomeIndex: number; balance: number }[] = [];

        if (market.type === "binary") {
          const [yesTokenAddress, noTokenAddress] = await Promise.all([
            readContract(config, {
              address: market.address as `0x${string}`,
              abi: MARKET_ABIS.binaryMarket,
              functionName: "yesToken",
            }),
            readContract(config, {
              address: market.address as `0x${string}`,
              abi: MARKET_ABIS.binaryMarket,
              functionName: "noToken",
            }),
          ]);

          const [yesBalance, noBalance] = await Promise.all([
            readContract(config, {
              address: yesTokenAddress as `0x${string}`,
              abi: [
                {
                  inputs: [{ name: "account", type: "address" }],
                  name: "balanceOf",
                  outputs: [{ name: "", type: "uint256" }],
                  stateMutability: "view",
                  type: "function",
                },
              ],
              functionName: "balanceOf",
              args: [address],
            }),
            readContract(config, {
              address: noTokenAddress as `0x${string}`,
              abi: [
                {
                  inputs: [{ name: "account", type: "address" }],
                  name: "balanceOf",
                  outputs: [{ name: "", type: "uint256" }],
                  stateMutability: "view",
                  type: "function",
                },
              ],
              functionName: "balanceOf",
              args: [address],
            }),
          ]);

          balances.push(
            { outcomeIndex: 0, balance: Number(yesBalance) / 1e18 },
            { outcomeIndex: 1, balance: Number(noBalance) / 1e18 }
          );
        }

        return balances;
      } catch (error) {
        console.error("Error fetching current balances:", error);
        return [];
      }
    },
    [address]
  );

  // Calculate position summaries
  const calculatePositions = useCallback(
    (
      market: Market,
      trades: TradeRecord[],
      currentBalances: { outcomeIndex: number; balance: number }[]
    ): PositionSummary[] => {
      const positions: { [key: number]: PositionSummary } = {};

      // Group trades by outcome
      trades.forEach((trade) => {
        if (!positions[trade.outcomeIndex]) {
          positions[trade.outcomeIndex] = {
            outcomeIndex: trade.outcomeIndex,
            outcome: trade.outcome,
            totalShares: 0,
            totalCostBasis: 0,
            currentTokenBalance: 0,
            avgCostPerShare: 0,
            currentValue: 0,
            unrealizedPnL: 0,
          };
        }

        positions[trade.outcomeIndex].totalShares += trade.shares;
        positions[trade.outcomeIndex].totalCostBasis += trade.costBasis;
      });

      // Add current balances and calculate P&L
      Object.keys(positions).forEach((key) => {
        const outcomeIndex = Number(key);
        const position = positions[outcomeIndex];

        // Find current balance for this outcome
        const currentBalance = currentBalances.find(
          (b) => b.outcomeIndex === outcomeIndex
        );
        position.currentTokenBalance = currentBalance?.balance || 0;

        // Calculate average cost per share
        position.avgCostPerShare =
          position.totalShares > 0
            ? position.totalCostBasis / position.totalShares
            : 0;

        // For unresolved markets, show potential profit scenarios
        // Don't show negative P&L until market is resolved
        position.currentValue = position.currentTokenBalance;

        // Calculate potential profit (positive scenarios only for unresolved markets)
        // This will be updated when market resolution logic is added
        position.unrealizedPnL = position.currentValue; // Show potential value, not loss
      });

      return Object.values(positions).filter((p) => p.totalShares > 0);
    },
    []
  );

  // Fetch trading history for a market
  const fetchTradingHistory = useCallback(
    async (market: Market): Promise<void> => {
      if (!address) return;

      setHistoryState({ isLoading: true, error: null, data: null });

      try {
        const trades = await getTradingHistory(market);
        const currentBalances = await getCurrentBalances(market);

        // If no trading history but user has tokens, create positions from current balances
        let positions: PositionSummary[];
        if (trades.length === 0 && currentBalances.some((b) => b.balance > 0)) {
          // Create positions from current balances (without cost basis)
          positions = currentBalances
            .filter((balance) => balance.balance > 0)
            .map((balance) => ({
              outcomeIndex: balance.outcomeIndex,
              outcome:
                market.outcomes[balance.outcomeIndex] ||
                `Outcome ${balance.outcomeIndex}`,
              totalShares: balance.balance,
              totalCostBasis: 0, // Unknown cost basis
              currentTokenBalance: balance.balance,
              avgCostPerShare: 0, // Unknown
              currentValue: balance.balance,
              unrealizedPnL: balance.balance, // Assume full value since we don't know cost
            }));
        } else {
          positions = calculatePositions(market, trades, currentBalances);
        }

        const totalCostBasis = positions.reduce(
          (sum, pos) => sum + pos.totalCostBasis,
          0
        );
        const totalCurrentValue = positions.reduce(
          (sum, pos) => sum + pos.currentValue,
          0
        );
        // For unresolved markets, show potential profit (positive scenarios)
        const totalUnrealizedPnL = totalCurrentValue; // Show potential value, not loss

        setHistoryState({
          isLoading: false,
          error: null,
          data: {
            positions,
            totalCostBasis,
            totalCurrentValue,
            totalUnrealizedPnL,
          },
        });
      } catch (error) {
        console.error("Error fetching trading history:", error);
        setHistoryState({
          isLoading: false,
          error: error instanceof Error ? error.message : "Unknown error",
          data: null,
        });
      }
    },
    [address, getTradingHistory, getCurrentBalances, calculatePositions]
  );

  return {
    historyState,
    fetchTradingHistory,
    addTrade, // Keep for compatibility but no longer used
  };
}
