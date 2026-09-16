"use client";
import React from "react";
import Layout from "../../components/Layout";
import ErrorBoundary from "../../components/ErrorBoundary";
import EnvironmentValidator from "../../components/EnvironmentValidator";
import UnansweredMessages from "../../components/UnansweredMessages.js";

// Force dynamic rendering for pages that use search parameters
export const dynamic = 'force-dynamic'

export default function UnansweredMessagesPage() {
	return (
		<EnvironmentValidator>
			<ErrorBoundary>
				<Layout>
					<UnansweredMessages />
				</Layout>
			</ErrorBoundary>
		</EnvironmentValidator>
	);
}
