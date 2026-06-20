"use client";
import React from "react";
import Layout from "../../components/Layout";
import ErrorBoundary from "../../components/ErrorBoundary";
import EnvironmentValidator from "../../components/EnvironmentValidator";
import ThanksForConnecting from "../../components/ThanksForConnecting.js";

// Force dynamic rendering for pages that use search parameters
export const dynamic = 'force-dynamic'

export default function ThanksForConnectingPage() {
	return (
		<EnvironmentValidator>
			<ErrorBoundary>
				<Layout>
					<ThanksForConnecting />
				</Layout>
			</ErrorBoundary>
		</EnvironmentValidator>
	);
}
