"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getBackendBase } from '../services/api';
import { getClientProfile, getCurrentClientId, getCurrentPortalToken, getCurrentDevKey } from '../utils/clientUtils';
import { CreditCardIcon, DocumentArrowDownIcon, CheckCircleIcon, ExclamationCircleIcon, ClockIcon, ArrowLeftIcon } from '@heroicons/react/24/outline';

/**
 * Billing Component
 * 
 * Displays client's billing information:
 * - Current subscription status
 * - Invoice history with PDF download links
 * 
 * Uses x-client-id header for API calls - backend looks up email from Master Clients table.
 */
export default function Billing() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [billingStatus, setBillingStatus] = useState(null);
  const [coachInfo, setCoachInfo] = useState({ name: null, email: null });
  const [portalLoading, setPortalLoading] = useState(false);
  // Where monthly tax invoices are emailed (blank = login email, resolved at send time)
  const [invoiceEmail, setInvoiceEmail] = useState({ value: '', saved: '', loginEmail: '', lastSent: null, loaded: false });
  const [invoiceEmailSaving, setInvoiceEmailSaving] = useState(false);
  const [invoiceEmailMsg, setInvoiceEmailMsg] = useState(null);

  // Get headers with x-client-id and portal token for authenticated API calls
  const getHeaders = useCallback(() => {
    const clientId = getCurrentClientId();
    const portalToken = getCurrentPortalToken();
    const devKey = getCurrentDevKey();
    const headers = {
      'Content-Type': 'application/json',
      'x-client-id': clientId || ''
    };
    if (portalToken) headers['x-portal-token'] = portalToken;
    if (devKey) headers['x-dev-key'] = devKey;
    return headers;
  }, []);

  // Get client email for display and fallback
  const getClientEmail = useCallback(() => {
    try {
      const profile = getClientProfile();
      // Check the nested client object for clientEmailAddress (from auth response)
      return profile?.client?.clientEmailAddress || profile?.email || profile?.Email || null;
    } catch (e) {
      console.error('Error getting client profile:', e);
      return null;
    }
  }, []);

  // Check billing service status
  const checkBillingStatus = useCallback(async () => {
    try {
      const backendBase = getBackendBase();
      const response = await fetch(`${backendBase}/api/billing/status`);
      const data = await response.json();
      setBillingStatus(data);
      return data.stripeAvailable;
    } catch (e) {
      console.error('Error checking billing status:', e);
      return false;
    }
  }, []);

  // Fetch subscription data - uses x-client-id header, backend looks up email
  const fetchSubscription = useCallback(async () => {
    try {
      const backendBase = getBackendBase();
      const response = await fetch(`${backendBase}/api/billing/subscription`, {
        headers: getHeaders()
      });
      const data = await response.json();
      if (data.success) {
        setSubscription(data.subscription);
      }
    } catch (e) {
      console.error('Error fetching subscription:', e);
    }
  }, [getHeaders]);

  // Fetch invoices - uses x-client-id header, backend looks up email
  const fetchInvoices = useCallback(async () => {
    try {
      const backendBase = getBackendBase();
      const response = await fetch(`${backendBase}/api/billing/invoices`, {
        headers: getHeaders()
      });
      const data = await response.json();
      if (data.success) {
        setInvoices(data.invoices || []);
        setCustomer(data.customer);
      }
    } catch (e) {
      console.error('Error fetching invoices:', e);
      throw e;
    }
  }, [getHeaders]);

  // Fetch where tax invoices go - never blocks the rest of the page
  const fetchInvoiceEmail = useCallback(async () => {
    try {
      const backendBase = getBackendBase();
      const response = await fetch(`${backendBase}/api/billing/invoice-email`, { headers: getHeaders() });
      const data = await response.json();
      if (data.success) {
        setInvoiceEmail({ value: data.billingEmail || '', saved: data.billingEmail || '', loginEmail: data.loginEmail || '', lastSent: data.lastSent || null, loaded: true });
      }
    } catch (e) {
      console.error('Error fetching invoice email:', e);
    }
  }, [getHeaders]);

  const saveInvoiceEmail = async () => {
    setInvoiceEmailSaving(true);
    setInvoiceEmailMsg(null);
    try {
      const backendBase = getBackendBase();
      const response = await fetch(`${backendBase}/api/billing/invoice-email`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ billingEmail: invoiceEmail.value })
      });
      const data = await response.json();
      if (data.success) {
        setInvoiceEmail((s) => ({ ...s, value: data.billingEmail, saved: data.billingEmail }));
        setInvoiceEmailMsg({ ok: true, text: `Saved. Your next tax invoice goes to ${data.billingEmail || data.loginEmail || 'your login email'}.` });
      } else {
        setInvoiceEmailMsg({ ok: false, text: data.error || 'Could not save - please try again.' });
      }
    } catch (e) {
      setInvoiceEmailMsg({ ok: false, text: 'Could not save - please try again.' });
    } finally {
      setInvoiceEmailSaving(false);
    }
  };

  // Load all billing data
  useEffect(() => {
    const loadBillingData = async () => {
      setLoading(true);
      setError(null);

      try {
        // Check if billing service is available
        const isAvailable = await checkBillingStatus();
        if (!isAvailable) {
          setError('Billing service is currently unavailable. Please try again later.');
          setLoading(false);
          return;
        }

        // Check that we have a client ID (for x-client-id header)
        const clientId = getCurrentClientId();
        if (!clientId) {
          setError('Unable to identify your account. Please ensure you are logged in correctly.');
          setLoading(false);
          return;
        }

        // Get coach info from client profile
        try {
          const profile = getClientProfile();
          if (profile?.client?.coachEmail) {
            setCoachInfo({
              name: profile.client.coachName || 'your coach',
              email: profile.client.coachEmail
            });
          }
        } catch (e) {
          console.error('Error getting coach info:', e);
        }

        // Fetch subscription and invoices in parallel
        // Backend will look up email from Master Clients table using x-client-id header
        await Promise.all([
          fetchSubscription(),
          fetchInvoices(),
          fetchInvoiceEmail()
        ]);

      } catch (e) {
        console.error('Error loading billing data:', e);
        setError('Failed to load billing information. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    loadBillingData();
  }, [checkBillingStatus, getClientEmail, fetchSubscription, fetchInvoices, fetchInvoiceEmail]);

  // Generate PDF download URL. A plain <a> link carries no headers, so the
  // portal token (or dev key) rides along as query params for the auth gate.
  const getPdfUrl = (invoiceId) => {
    const backendBase = getBackendBase();
    const params = new URLSearchParams();
    const portalToken = getCurrentPortalToken();
    const devKey = getCurrentDevKey();
    const clientId = getCurrentClientId();
    if (portalToken) {
      params.set('token', portalToken);
    } else if (devKey && clientId) {
      params.set('client', clientId);
      params.set('devKey', devKey);
    }
    const qs = params.toString();
    return `${backendBase}/api/billing/invoice/${invoiceId}/pdf${qs ? `?${qs}` : ''}`;
  };

  // Open Stripe Customer Portal for payment method management
  const openPaymentPortal = async () => {
    setPortalLoading(true);
    try {
      const backendBase = getBackendBase();
      const response = await fetch(`${backendBase}/api/billing/portal`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          returnUrl: window.location.href
        })
      });
      const data = await response.json();
      if (data.success && data.url) {
        // Redirect to Stripe's hosted portal
        window.location.href = data.url;
      } else {
        console.error('Failed to create portal session:', data.message);
        alert('Unable to open payment portal. Please try again.');
      }
    } catch (e) {
      console.error('Error opening payment portal:', e);
      alert('Unable to open payment portal. Please try again.');
    } finally {
      setPortalLoading(false);
    }
  };

  // Status badge component
  const StatusBadge = ({ status }) => {
    const statusConfig = {
      paid: { icon: CheckCircleIcon, color: 'text-green-600 bg-green-50', label: 'Paid' },
      open: { icon: ClockIcon, color: 'text-yellow-600 bg-yellow-50', label: 'Pending' },
      draft: { icon: ClockIcon, color: 'text-gray-600 bg-gray-50', label: 'Draft' },
      void: { icon: ExclamationCircleIcon, color: 'text-red-600 bg-red-50', label: 'Void' },
      uncollectible: { icon: ExclamationCircleIcon, color: 'text-red-600 bg-red-50', label: 'Failed' }
    };
    const config = statusConfig[status] || statusConfig.open;
    const Icon = config.icon;

    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${config.color}`}>
        <Icon className="h-3.5 w-3.5" />
        {config.label}
      </span>
    );
  };

  // Loading state
  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-48 mb-6"></div>
          <div className="h-32 bg-gray-200 rounded mb-6"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2">
          <CreditCardIcon className="h-7 w-7 text-gray-400" />
          Billing & Invoices
        </h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <ExclamationCircleIcon className="h-5 w-5 text-red-500 mt-0.5" />
            <div>
              <h3 className="text-sm font-medium text-red-800">Error Loading Billing</h3>
              <p className="text-sm text-red-700 mt-1">{error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center space-x-3 mb-6">
        <Link
          href={`/settings?${searchParams.toString()}`}
          className="inline-flex items-center justify-center p-2 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          title="Back to Settings"
        >
          <ArrowLeftIcon className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <CreditCardIcon className="h-7 w-7 text-blue-600" />
          Billing & Invoices
        </h1>
      </div>

      {/* Current Subscription Card */}
      {subscription && (
        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Current Plan</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-sm text-gray-500">Plan</p>
              <p className="text-lg font-medium text-gray-900">{subscription.planName}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Amount</p>
              <p className="text-lg font-medium text-gray-900">
                {subscription.amountFormatted} / {subscription.interval}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Next Billing Date</p>
              <p className="text-lg font-medium text-gray-900">{subscription.nextBillingDate}</p>
            </div>
          </div>
          
          {/* Update Payment Method Button */}
          <div className="mt-4 pt-4 border-t border-gray-100">
            <button
              onClick={openPaymentPortal}
              disabled={portalLoading}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CreditCardIcon className="h-4 w-4" />
              {portalLoading ? 'Opening...' : 'Update Payment Method'}
            </button>
          </div>
          
          {subscription.cancelAtPeriodEnd && (
            <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-md p-3">
              <p className="text-sm text-yellow-800">
                ⚠️ Your subscription will end on {subscription.nextBillingDate}
              </p>
            </div>
          )}
        </div>
      )}

      {/* No subscription message */}
      {!subscription && invoices.length === 0 && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 mb-6 text-center">
          <CreditCardIcon className="h-12 w-12 text-gray-300 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-gray-900 mb-1">No Billing History</h3>
          <p className="text-gray-500">You don't have any invoices yet.</p>
        </div>
      )}

      {/* Payment method button for users without active subscription but with invoices */}
      {!subscription && invoices.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Payment Method</h2>
              <p className="text-sm text-gray-500">Manage your saved payment details</p>
            </div>
            <button
              onClick={openPaymentPortal}
              disabled={portalLoading}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CreditCardIcon className="h-4 w-4" />
              {portalLoading ? 'Opening...' : 'Update Payment Method'}
            </button>
          </div>
        </div>
      )}

      {/* Where tax invoices are emailed */}
      {invoiceEmail.loaded && (
        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Tax invoices by email</h2>
          <label htmlFor="invoice-email" className="block text-sm text-gray-700 mb-2">
            Where should we send your monthly tax invoices?
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              id="invoice-email"
              type="text"
              value={invoiceEmail.value}
              onChange={(e) => { setInvoiceEmail((s) => ({ ...s, value: e.target.value })); setInvoiceEmailMsg(null); }}
              placeholder={invoiceEmail.loginEmail ? `Using your login email (${invoiceEmail.loginEmail})` : 'Using your login email'}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={saveInvoiceEmail}
              disabled={invoiceEmailSaving || invoiceEmail.value.trim() === invoiceEmail.saved}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {invoiceEmailSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            To send to more than one address, put a comma between them - handy if your bookkeeper needs a copy. Leave it empty to use your login email.
          </p>
          {invoiceEmailMsg && (
            <p className={`text-sm mt-2 ${invoiceEmailMsg.ok ? 'text-green-700' : 'text-red-700'}`}>{invoiceEmailMsg.text}</p>
          )}
          <p className="text-sm text-gray-600 mt-3">
            {invoiceEmail.lastSent
              ? `Last tax invoice emailed ${new Date(invoiceEmail.lastSent.at).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })} to ${invoiceEmail.lastSent.recipients}.`
              : 'No tax invoices emailed yet - the next one goes out when your next payment goes through.'}
          </p>
        </div>
      )}

      {/* Invoice History */}
      {invoices.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Invoice History</h2>
            {customer && (
              <p className="text-sm text-gray-500">{customer.name || customer.email}</p>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Description
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Amount
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Invoice
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {invoices.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-gray-50">
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                      {invoice.dateFormatted}
                    </td>
                    <td className="px-4 py-4 text-sm text-gray-600">
                      {invoice.description}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {invoice.amountFormatted}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <StatusBadge status={invoice.status} />
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-right">
                      <a
                        href={getPdfUrl(invoice.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-md transition-colors"
                      >
                        <DocumentArrowDownIcon className="h-4 w-4" />
                        Download PDF
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 text-sm text-gray-500">
            Showing {invoices.length} invoice{invoices.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}

      {/* Subscription contact info */}
      {coachInfo.email && (
        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg text-center">
          <p className="text-sm text-blue-800">
            To make changes to your subscription, contact {coachInfo.name || 'your coach'} at{' '}
            <a 
              href={`mailto:${coachInfo.email}`} 
              className="font-medium text-blue-600 hover:text-blue-800 underline"
            >
              {coachInfo.email}
            </a>
          </p>
        </div>
      )}

      {/* Footer info */}
      <div className="mt-6 text-center text-sm text-gray-500">
        <p>All invoices include GST where applicable.</p>
        <p className="mt-1">
          {billingStatus?.businessName} · ABN: {billingStatus?.abn}
        </p>
      </div>
    </div>
  );
}
