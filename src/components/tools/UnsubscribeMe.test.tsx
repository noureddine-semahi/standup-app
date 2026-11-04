import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import type { Subscription } from "@/lib/subscriptions";
import type { SubscriptionCancellation } from "@/lib/cancellation";
import SubscriptionsTracker from "./SubscriptionsTracker";
import type { SubscriptionsController } from "./useSubscriptions";

const TODAY = "2026-11-04";

const sub = (over: Partial<Subscription> = {}): Subscription => ({
  id: "s1",
  name: "Netflix",
  provider: null,
  category: null,
  planName: null,
  amount: 15.49,
  currency: "USD",
  frequency: "monthly",
  customInterval: null,
  customUnit: null,
  nextBillingDate: "2026-11-20",
  startDate: null,
  status: "active",
  trialEndsOn: null,
  remindDaysBefore: 3,
  notes: null,
  billId: null,
  canceledAt: null,
  cancelUrl: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...over,
});

const cancellation = (over: Partial<SubscriptionCancellation> = {}): SubscriptionCancellation => ({
  id: "c1",
  subscriptionId: "s1",
  mode: "manual",
  status: "user_reported",
  requestedAt: "2026-11-01T10:00:00Z",
  completedOn: "2026-11-01",
  guideUrl: null,
  providerReference: null,
  errorMessage: null,
  note: null,
  ...over,
});

function controller(over: Partial<SubscriptionsController> = {}): SubscriptionsController {
  return {
    state: "ready",
    loadError: null,
    subscriptions: [sub()],
    payments: {},
    create: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(null),
    changeStatus: vi.fn().mockResolvedValue(null),
    remove: vi.fn().mockResolvedValue(null),
    recordPayment: vi.fn().mockResolvedValue(null),
    reversePayment: vi.fn().mockResolvedValue(null),
    cancellationsState: "ready",
    cancellations: {},
    saveCancelUrl: vi.fn().mockResolvedValue(null),
    startAssistedCancellation: vi.fn().mockResolvedValue(null),
    reportCancellation: vi.fn().mockResolvedValue(null),
    reportCancellationFailure: vi.fn().mockResolvedValue(null),
    ...over,
  };
}

function setup(over: Partial<SubscriptionsController> = {}) {
  const c = controller(over);
  render(
    <LanguageProvider>
      <SubscriptionsTracker controller={c} todayISO={TODAY} bills={[]} />
    </LanguageProvider>
  );
  return c;
}

const openUnsubscribe = (name = "Netflix") => {
  fireEvent.click(screen.getByRole("button", { name: `More ${name}` }));
  fireEvent.click(within(screen.getByRole("group", { name: `More ${name}` })).getByRole("button", { name: "Unsubscribe Me" }));
};

afterEach(cleanup);

describe("Unsubscribe Me entry point", () => {
  it("is offered for tracked subscriptions that aren't already canceled", () => {
    setup({ subscriptions: [sub({ id: "a", name: "Act" }), sub({ id: "c", name: "Can", status: "canceled" })] });
    fireEvent.click(screen.getByRole("button", { name: "More Act" }));
    expect(within(screen.getByRole("group", { name: "More Act" })).getByRole("button", { name: "Unsubscribe Me" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "More Can" }));
    expect(within(screen.getByRole("group", { name: "More Can" })).queryByRole("button", { name: "Unsubscribe Me" })).toBeNull();
  });

  it("says so when the cancellations migration isn't applied, and offers no route", () => {
    setup({ cancellationsState: "unavailable" });
    openUnsubscribe();
    expect(screen.getByTestId("unsub-unavailable")).toBeTruthy();
    expect(screen.queryByTestId("unsub-open")).toBeNull();
    expect(screen.queryByTestId("unsub-manual")).toBeNull();
  });
});

describe("automatic cancellation is never offered or simulated", () => {
  it("shows it as unavailable with the reason, and there is no button that could 'cancel for you'", () => {
    const c = setup();
    openUnsubscribe();
    const auto = within(screen.getByTestId("unsub-auto"));
    expect(auto.getByText(/no authorized integration/)).toBeTruthy();
    expect(auto.queryByRole("button")).toBeNull();
    expect(c.reportCancellation).not.toHaveBeenCalled();
    expect(c.startAssistedCancellation).not.toHaveBeenCalled();
  });
  it("never asks for a provider password", () => {
    setup();
    openUnsubscribe();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.getByText(/never asks for your provider password/)).toBeTruthy();
  });
});

describe("guided (assisted) cancellation", () => {
  it("without a link: explains, and saves only a valid https link", async () => {
    const c = setup();
    openUnsubscribe();
    expect(screen.queryByTestId("unsub-open")).toBeNull();
    const input = screen.getByLabelText(/Cancellation page link/);
    fireEvent.change(input, { target: { value: "http://example.com/cancel" } });
    fireEvent.click(screen.getByRole("button", { name: "Save link" }));
    expect(screen.getByText(/full https:\/\/ link/)).toBeTruthy();
    expect(c.saveCancelUrl).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "https://user:pw@example.com/cancel" } });
    fireEvent.click(screen.getByRole("button", { name: "Save link" }));
    expect(c.saveCancelUrl).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "https://example.com/account/cancel" } });
    fireEvent.click(screen.getByRole("button", { name: "Save link" }));
    await waitFor(() => expect(c.saveCancelUrl).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }), "https://example.com/account/cancel"));
  });

  it("with a saved link: opens it safely, labels it as the user's, logs a request, and never claims it was canceled", async () => {
    const c = setup({ subscriptions: [sub({ cancelUrl: "https://example.com/cancel" })] });
    openUnsubscribe();
    const link = screen.getByTestId("unsub-open") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://example.com/cancel");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText(/StandUp hasn’t verified it/)).toBeTruthy();
    expect(screen.getByText(/Opening the page doesn’t cancel anything/)).toBeTruthy();
    fireEvent.click(link);
    await waitFor(() => expect(c.startAssistedCancellation).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }), "https://example.com/cancel"));
    expect(await screen.findByText(/StandUp can’t tell whether you finished/)).toBeTruthy();
    // opening the page changed nothing about the subscription
    expect(c.reportCancellation).not.toHaveBeenCalled();
    expect(c.changeStatus).not.toHaveBeenCalled();
  });

  it("doesn't log a second request while one is already open", () => {
    const c = setup({
      subscriptions: [sub({ cancelUrl: "https://example.com/cancel" })],
      cancellations: { s1: [cancellation({ status: "in_progress", mode: "assisted", completedOn: null })] },
    });
    openUnsubscribe();
    expect(screen.getByTestId("unsub-pending").textContent).toContain("StandUp hasn’t confirmed anything");
    fireEvent.click(screen.getByTestId("unsub-open"));
    expect(c.startAssistedCancellation).not.toHaveBeenCalled();
  });
});

describe("manual cancellation (user-reported)", () => {
  it("records the date and note as a user report, and says it isn't provider-confirmed", async () => {
    const c = setup();
    openUnsubscribe();
    fireEvent.click(within(screen.getByTestId("unsub-manual")).getByRole("button", { name: "I canceled it myself" }));
    expect(screen.getByText(/not confirmed by the provider/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Date you canceled"), { target: { value: "2026-11-02" } });
    fireEvent.change(screen.getByLabelText(/Note/), { target: { value: "Emailed support" } });
    fireEvent.click(screen.getByRole("button", { name: "Record cancellation" }));
    await waitFor(() =>
      expect(c.reportCancellation).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }), { completedOn: "2026-11-02", note: "Emailed support" }, null)
    );
    expect(await screen.findByText(/reported by you on 11\/02\/2026/)).toBeTruthy();
    expect(screen.queryByTestId("unsub-modal")).toBeNull();
  });

  it("rejects a future date and doesn't call the controller", () => {
    const c = setup();
    openUnsubscribe();
    fireEvent.click(within(screen.getByTestId("unsub-manual")).getByRole("button", { name: "I canceled it myself" }));
    fireEvent.change(screen.getByLabelText("Date you canceled"), { target: { value: "2026-12-01" } });
    expect((screen.getByRole("button", { name: "Record cancellation" }) as HTMLButtonElement).disabled).toBe(true);
    expect(c.reportCancellation).not.toHaveBeenCalled();
  });

  it("resolves the open guided request when one exists", async () => {
    const c = setup({ cancellations: { s1: [cancellation({ id: "req-9", status: "in_progress", mode: "assisted", completedOn: null })] } });
    openUnsubscribe();
    fireEvent.click(within(screen.getByTestId("unsub-manual")).getByRole("button", { name: "I canceled it myself" }));
    fireEvent.click(screen.getByRole("button", { name: "Record cancellation" }));
    await waitFor(() => expect(c.reportCancellation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ completedOn: TODAY }), "req-9"));
  });

  it("shows the error and stays open when saving fails (nothing is marked canceled)", async () => {
    setup({ reportCancellation: vi.fn().mockResolvedValue("Network down") });
    openUnsubscribe();
    fireEvent.click(within(screen.getByTestId("unsub-manual")).getByRole("button", { name: "I canceled it myself" }));
    fireEvent.click(screen.getByRole("button", { name: "Record cancellation" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Network down");
    expect(screen.getByTestId("unsub-modal")).toBeTruthy();
  });
});

describe("recording that it didn't work", () => {
  it("is offered once a guided request is open, requires a description, and keeps the error", async () => {
    const c = setup({ cancellations: { s1: [cancellation({ id: "req-9", status: "in_progress", mode: "assisted", completedOn: null })] } });
    openUnsubscribe();
    fireEvent.click(screen.getByRole("button", { name: "It didn’t work" }));
    expect((screen.getByRole("button", { name: "Save problem" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("What happened?"), { target: { value: "CAPTCHA kept failing" } });
    fireEvent.click(screen.getByRole("button", { name: "Save problem" }));
    await waitFor(() => expect(c.reportCancellationFailure).toHaveBeenCalledWith(expect.anything(), "CAPTCHA kept failing", "req-9"));
    expect(c.reportCancellation).not.toHaveBeenCalled();
  });
  it("isn't offered when nothing was started", () => {
    setup();
    openUnsubscribe();
    expect(screen.queryByRole("button", { name: "It didn’t work" })).toBeNull();
  });
});

describe("status display keeps user-reported and provider-confirmed apart", () => {
  it("a user report reads as reported by you and not confirmed", () => {
    setup({
      subscriptions: [sub({ status: "canceled", canceledAt: "2026-11-01T00:00:00Z" })],
      cancellations: { s1: [cancellation()] },
    });
    const badge = screen.getByTestId("sub-cancel-badge");
    expect(badge.textContent).toBe("Canceled — reported by you on 11/01/2026. Not confirmed by the provider.");
    expect(badge.getAttribute("data-kind")).toBe("reported");
  });
  it("only a provider-confirmed record reads as confirmed by the provider", () => {
    setup({
      subscriptions: [sub({ status: "canceled" })],
      cancellations: { s1: [cancellation({ status: "provider_confirmed", mode: "automatic", providerReference: "r1" })] },
    });
    expect(screen.getByTestId("sub-cancel-badge").textContent).toBe("Cancellation confirmed by the provider");
  });
  it("shows in-progress and failed attempts on a still-tracked subscription", () => {
    setup({ cancellations: { s1: [cancellation({ status: "in_progress", mode: "assisted", completedOn: null })] } });
    expect(screen.getByTestId("sub-cancel-badge").textContent).toBe("Cancellation in progress — not confirmed");
    cleanup();
    setup({ cancellations: { s1: [cancellation({ status: "failed", completedOn: null, errorMessage: "Needs a phone call" })] } });
    expect(screen.getByTestId("sub-cancel-badge").textContent).toBe("Cancellation didn’t go through: Needs a phone call");
  });
  it("a reactivated subscription no longer shows a stale 'canceled' line", () => {
    setup({ cancellations: { s1: [cancellation()] } });
    expect(screen.queryByTestId("sub-cancel-badge")).toBeNull();
  });
  it("history lists every request, labeled by route and status", () => {
    setup({
      subscriptions: [sub({ status: "canceled" })],
      cancellations: {
        s1: [
          cancellation({ id: "b", requestedAt: "2026-11-01T10:00:00Z" }),
          cancellation({ id: "a", status: "failed", mode: "assisted", completedOn: null, requestedAt: "2026-10-20T10:00:00Z", errorMessage: "Wrong page" }),
        ],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "History Netflix" }));
    const h = within(screen.getByTestId("sub-cancel-history"));
    expect(h.getByText("Manual · Reported by you · 11/01/2026")).toBeTruthy();
    expect(h.getByText("Guided · Failed · 10/20/2026")).toBeTruthy();
    expect(h.getByText("Wrong page")).toBeTruthy();
  });
});

describe("projected savings", () => {
  it("is labeled as reported-by-you, a projection, and not money already saved", () => {
    setup({
      subscriptions: [sub({ status: "canceled" })],
      cancellations: { s1: [cancellation()] },
    });
    const box = screen.getByTestId("subs-savings");
    expect(within(box).getByTestId("subs-savings-reported").textContent).toBe(
      "Reported by you, not confirmed by providers: $15.49/mo · $185.88/yr from 1."
    );
    expect(within(box).queryByTestId("subs-savings-confirmed")).toBeNull();
    expect(box.textContent).toContain("It is not money already saved.");
  });
  it("shows confirmed savings on their own line", () => {
    setup({
      subscriptions: [sub({ status: "canceled", amount: 10 })],
      cancellations: { s1: [cancellation({ status: "provider_confirmed", mode: "automatic", providerReference: "r1" })] },
    });
    expect(screen.getByTestId("subs-savings-confirmed").textContent).toBe("Confirmed by providers: $10.00/mo · $120.00/yr from 1.");
    expect(screen.queryByTestId("subs-savings-reported")).toBeNull();
  });
  it("is absent when nothing was canceled through a recorded cancellation (a plain 'Mark canceled' isn't counted)", () => {
    setup({ subscriptions: [sub({ status: "canceled" })] });
    expect(screen.queryByTestId("subs-savings")).toBeNull();
  });
  it("doesn't change the Monthly Cost tile, which already excludes canceled subscriptions", () => {
    setup({
      subscriptions: [sub({ id: "x", name: "Keep", amount: 10 }), sub({ status: "canceled" })],
      cancellations: { s1: [cancellation()] },
    });
    expect(screen.getByTestId("subs-monthly").textContent).toBe("$10.00");
  });
});
