import { createContext, useContext, type RefObject } from "react";
import type { AuctionView, Mode } from "./auction-study";

export type SelectionContext = {
  view: AuctionView;
  mode: Mode;
  chooseMode: (mode: Mode) => void;
  revealed: number;
  pending: boolean;
  evidenceSelected: boolean;
  cursor: number | "close";
  playbackRef: RefObject<HTMLInputElement | null>;
  seek: (tick: number | "close") => void;
  seekEvidence: (tick: number) => void;
  selectedActor: string;
  selectActor: (actor: string) => void;
  pinned: string;
  pin: (actor: string) => void;
  comparisonRun: string | undefined;
  checkpoint: number;
  setCheckpoint: (checkpoint: number) => void;
};

export const AuctionSelection = createContext<SelectionContext | null>(null);

export function useAuctionSelection() {
  const selection = useContext(AuctionSelection);
  if (!selection) throw new Error("Auction selection is required");
  return selection;
}
