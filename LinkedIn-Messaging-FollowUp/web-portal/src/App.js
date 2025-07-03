import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import LeadSearchUpdate from './components/LeadSearchUpdate';
import FollowUpManager from './components/FollowUpManager';
import NewLeads from './components/NewLeads';

function App() {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<LeadSearchUpdate />} />
          <Route path="/lead-search" element={<LeadSearchUpdate />} />
          <Route path="/follow-up" element={<FollowUpManager />} />
          <Route path="/new-leads" element={<NewLeads />} />
        </Routes>
      </Layout>
    </Router>
  );
}

export default App;
