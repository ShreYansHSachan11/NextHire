"use client";

import React, { useState } from "react";
import { useSelector } from "react-redux";
import { useRouter } from "next/navigation";
import type { RootState } from "../../../store/store";

export default function PostJobPage() {
  const { user, isAuthenticated } = useSelector((state: RootState) => state.auth);
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    salary: "",
    experience: "",
    location: "",
    type: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [debugInfo, setDebugInfo] = useState("");
  const [userDetails, setUserDetails] = useState<any>(null);
  const router = useRouter();

  if (!isAuthenticated || user?.role !== "COMPANY") {
    if (typeof window !== "undefined") router.push("/auth/login");
    return null;
  }

  const fetchUserDetails = async () => {
    if (!user?.id) return;
    
    try {
      const response = await fetch(`/api/users?id=${user.id}`);
      if (response.ok) {
        const data = await response.json();
        setUserDetails(data);
        console.log('User details:', data);
      }
    } catch (error) {
      console.error('Failed to fetch user details:', error);
    }
  };

  const createCompany = async () => {
    if (!user?.name || !user?.id) {
      setError('User information is required to create a company');
      return;
    }
    
    try {
      setLoading(true);
      const response = await fetch('/api/companies', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: user.id,
          name: user.name,
          profile: 'Company profile created automatically'
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create company');
      }
      
      setSuccess('Company created and linked successfully! Please refresh the page.');
      setTimeout(() => window.location.reload(), 2000);
      
    } catch (error: any) {
      setError(error.message || 'Failed to create company');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchUserDetails();
  }, [user?.id]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const validateForm = () => {
    const errors = [];
    
    if (!formData.title.trim()) {
      errors.push("Job title is required");
    }
    
    if (!formData.description.trim()) {
      errors.push("Job description is required");
    }
    
    if (!formData.type) {
      errors.push("Job type is required");
    }
    

    
    if (!user?.companyId) {
      errors.push("Company ID is missing. Please contact support.");
    }
    
    return errors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setDebugInfo("");
    setLoading(true);
    
    try {
      // Frontend validation
      const validationErrors = validateForm();
      if (validationErrors.length > 0) {
        setError(validationErrors.join(", "));
        setLoading(false);
        return;
      }
      
      // Prepare request data
      const requestData = { 
        ...formData, 
        companyId: user.companyId 
      };
      
      console.log('Submitting job data:', requestData);
      setDebugInfo(`Submitting with companyId: ${user.companyId}`);
      
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${document.cookie.split('; ').find(row => row.startsWith('token='))?.split('=')[1]}`
        },
        body: JSON.stringify(requestData),
      });
      
      const data = await response.json();
      console.log('Response status:', response.status);
      console.log('Response data:', data);
      
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}: Job posting failed`);
      }
      
      setSuccess(`Job posted successfully! Job ID: ${data.id}`);
      setDebugInfo(`Job created with ID: ${data.id}`);
      setTimeout(() => router.push("/company/dashboard"), 3000);
      
    } catch (err: any) {
      console.error('Job posting error:', err);
      setError(err.message || "Job posting failed");
      setDebugInfo(`Error details: ${err.toString()}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-8">
      <div className="w-full max-w-lg bg-white rounded-lg shadow-md p-8">
        <h1 className="text-3xl font-bold mb-6 text-blue-700 text-center">Post a Job</h1>
        
        {/* Debug Information */}
        {debugInfo && (
          <div className="mb-4 p-3 bg-blue-100 border border-blue-400 text-blue-700 rounded text-sm">
            <strong>Debug Info:</strong> {debugInfo}
          </div>
        )}
        
        {/* Test Job Creation */}
        {user?.companyId && (
          <div className="mb-4 p-3 bg-yellow-100 border border-yellow-400 rounded text-sm">
            <div className="flex justify-between items-center mb-2">
              <strong>Test Job Creation</strong>
              <button
                onClick={async () => {
                  try {
                    const testData = {
                      title: "Test Job",
                      description: "This is a test job posting",
                      type: "Full Time",
                      companyId: user.companyId
                    };
                    
                    const response = await fetch("/api/jobs", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(testData),
                    });
                    
                    const data = await response.json();
                    console.log('Test job creation response:', response.status, data);
                    
                    if (response.ok) {
                      setDebugInfo(`Test job created successfully with ID: ${data.id}`);
                    } else {
                      setDebugInfo(`Test job failed: ${data.error}`);
                    }
                  } catch (error: any) {
                    setDebugInfo(`Test job error: ${error.message}`);
                  }
                }}
                className="text-xs bg-yellow-500 text-white px-2 py-1 rounded hover:bg-yellow-600"
              >
                Test API
              </button>
            </div>
            <p>Click "Test API" to test job creation with sample data</p>
          </div>
        )}
        
        {/* List All Companies */}
        <div className="mb-4 p-3 bg-purple-100 border border-purple-400 rounded text-sm">
          <div className="flex justify-between items-center mb-2">
            <strong>List All Companies</strong>
            <button
              onClick={async () => {
                try {
                  const response = await fetch("/api/companies");
                  const data = await response.json();
                  console.log('All companies:', data);
                  setDebugInfo(`Found ${data.length} companies in the system`);
                } catch (error: any) {
                  setDebugInfo(`Error fetching companies: ${error.message}`);
                }
              }}
              className="text-xs bg-purple-500 text-white px-2 py-1 rounded hover:bg-purple-600"
            >
              List Companies
            </button>
          </div>
          <p>Click "List Companies" to see all companies in the system</p>
        </div>
        
        {/* User Info */}
        <div className="mb-4 p-3 bg-gray-100 border border-gray-300 rounded text-sm">
          <div className="flex justify-between items-start mb-2">
            <strong>User Information</strong>
            <button
              onClick={fetchUserDetails}
              className="text-xs bg-blue-500 text-white px-2 py-1 rounded hover:bg-blue-600"
            >
              Refresh
            </button>
          </div>
          <strong>User:</strong> {user?.name} ({user?.email})<br/>
          <strong>Role:</strong> {user?.role}<br/>
          <strong>Company ID:</strong> {user?.companyId || 'Not set'}<br/>
          {userDetails && (
            <>
              <strong>Company Name:</strong> {userDetails.company?.name || 'Not found'}<br/>
              <strong>Company Profile:</strong> {userDetails.company?.profile || 'Not set'}<br/>
              <strong>Company Created:</strong> {userDetails.company?.createdAt ? new Date(userDetails.company.createdAt).toLocaleDateString() : 'Unknown'}
            </>
          )}
        </div>
        
        {error && <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">{error}</div>}
        {success && <div className="mb-4 p-3 bg-green-100 border border-green-400 text-green-700 rounded">{success}</div>}
        
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Job Title *</label>
            <input
              type="text"
              name="title"
              placeholder="e.g. Senior Software Engineer"
              value={formData.title}
              onChange={handleChange}
              required
              className="w-full px-4 py-2 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Job Description *</label>
            <textarea
              name="description"
              placeholder="Describe the role, responsibilities, and requirements..."
              value={formData.description}
              onChange={handleChange}
              required
              rows={4}
              className="w-full px-4 py-2 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Salary (optional)</label>
            <input
              type="text"
              name="salary"
              placeholder="e.g. $80,000 - $120,000"
              value={formData.salary}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Experience (optional)</label>
            <input
              type="text"
              name="experience"
              placeholder="e.g. 3-5 years"
              value={formData.experience}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Location (optional)</label>
            <input
              type="text"
              name="location"
              placeholder="e.g. Remote, New York, NY"
              value={formData.location}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Job Type *</label>
            <select
              name="type"
              value={formData.type}
              onChange={handleChange}
              required
              className="w-full px-4 py-2 border border-gray-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option value="">Select Job Type</option>
              <option value="Full Time">Full Time</option>
              <option value="Part Time">Part Time</option>
              <option value="Internship">Internship</option>
              <option value="Contract">Contract</option>
            </select>
          </div>
          
          <button
            type="submit"
            disabled={loading || !user?.companyId}
            className="bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 transition font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Posting..." : "Post Job"}
          </button>
          
          {!user?.companyId && (
            <div className="text-center">
              <p className="text-red-600 text-sm mb-2">
                Cannot post job: Company ID is missing.
              </p>
              <button
                onClick={createCompany}
                disabled={loading}
                className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50 text-sm"
              >
                {loading ? "Creating..." : "Create Company"}
              </button>
            </div>
          )}
        </form>
        
        <button
          className="mt-4 w-full bg-gray-200 text-gray-700 py-2 px-4 rounded hover:bg-gray-300 transition"
          onClick={() => router.push("/company/dashboard")}
        >
          Cancel
        </button>
      </div>
    </main>
  );
} 