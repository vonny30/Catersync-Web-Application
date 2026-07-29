// src/pages/ShortOrders.jsx
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Search, Check, Edit, Trash2, ChevronLeft, ChevronRight, X, RefreshCw, Plus } from 'lucide-react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';

export default function ShortOrders() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');

  // --- Modal states ---
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    customer_id: '',
    booking_type: 'Short Order',
    event_datetime: '',
    venue: '',
    pax_count: '',
    notes: '',
    total_amount: '0',
    delivery_fee: '0',
    menu_selections: [],
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tempItem, setTempItem] = useState({ menu_item_id: '', quantity: 1 });

  // --- Approval modal state ---
  const [isApprovalModalOpen, setIsApprovalModalOpen] = useState(false);
  const [approvalOrder, setApprovalOrder] = useState(null);
  const [approvalData, setApprovalData] = useState({
    extraQuantity: 0,
    additionalFee: 0,
    extraDeliveryFee: 0,
    newTotal: 0,
    baseTotal: 0,
  });

  // --- Helper: Log technical error and show user-friendly toast ---
  const handleError = (error, userMessage = 'Something went wrong. Please try again.') => {
    console.error('Error:', error);
    toast.error(userMessage);
  };

  // --- Fetch data ---
  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: ordersData, error: ordersError } = await supabase
        .from('booking')
        .select(`
          *,
          customer:customer_id (first_name, last_name, contact_no)
        `)
        .eq('booking_type', 'Short Order')
        .order('event_datetime', { ascending: false });
      if (ordersError) throw ordersError;
      setOrders(ordersData || []);

      const { data: customersData, error: customersError } = await supabase
        .from('customer')
        .select('customer_id, first_name, last_name')
        .eq('account_status', 'Active')
        .order('first_name');
      if (customersError) throw customersError;
      setCustomers(customersData || []);

      const { data: menuData, error: menuError } = await supabase
        .from('menu_item')
        .select('menu_item_id, menu_name, menu_price')
        .eq('menu_availability', 'Available')
        .order('menu_name');
      if (menuError) throw menuError;
      setMenuItems(menuData || []);
    } catch (error) {
      handleError(error, 'Unable to load short orders. Please refresh the page.');
      setOrders([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // --- Auto-calculate total when selections change ---
  useEffect(() => {
    const total = formData.menu_selections.reduce((sum, sel) => {
      const menuItem = menuItems.find(m => m.menu_item_id === sel.menu_item_id);
      return sum + (menuItem ? menuItem.menu_price * sel.quantity : 0);
    }, 0) + parseFloat(formData.delivery_fee || 0);

    setFormData(prev => ({
      ...prev,
      total_amount: total.toFixed(2),
    }));
  }, [formData.menu_selections, formData.delivery_fee, menuItems]);

  // --- Handlers ---
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleTempItemChange = (e) => {
    const { name, value } = e.target;
    setTempItem(prev => ({ ...prev, [name]: value }));
  };

  const addItemToSelection = () => {
    if (!tempItem.menu_item_id) {
      toast.error('Please select a menu item.');
      return;
    }
    if (tempItem.quantity < 1) {
      toast.error('Quantity must be at least 1.');
      return;
    }
    const existing = formData.menu_selections.find(
      item => item.menu_item_id === tempItem.menu_item_id
    );
    if (existing) {
      toast.error('This item is already added. Remove it first to change quantity.');
      return;
    }
    setFormData(prev => ({
      ...prev,
      menu_selections: [...prev.menu_selections, { ...tempItem }],
    }));
    setTempItem({ menu_item_id: '', quantity: 1 });
  };

  const removeItemFromSelection = (menu_item_id) => {
    setFormData(prev => ({
      ...prev,
      menu_selections: prev.menu_selections.filter(item => item.menu_item_id !== menu_item_id),
    }));
  };

  const updateItemQuantity = (menu_item_id, quantity) => {
    if (quantity < 1) return;
    setFormData(prev => ({
      ...prev,
      menu_selections: prev.menu_selections.map(item =>
        item.menu_item_id === menu_item_id ? { ...item, quantity: parseInt(quantity) } : item
      ),
    }));
  };

  const openNewModal = () => {
    setEditingId(null);
    setFormData({
      customer_id: '',
      booking_type: 'Short Order',
      event_datetime: '',
      venue: '',
      pax_count: '',
      notes: '',
      total_amount: '0',
      delivery_fee: '0',
      menu_selections: [],
    });
    setTempItem({ menu_item_id: '', quantity: 1 });
    setIsModalOpen(true);
  };

  const openEditModal = (order) => {
    setEditingId(order.booking_id);
    let selections = [];
    try {
      if (order.menu_selections) {
        if (typeof order.menu_selections === 'string') {
          selections = JSON.parse(order.menu_selections);
        } else if (Array.isArray(order.menu_selections)) {
          selections = order.menu_selections;
        }
      }
    } catch (e) {
      console.warn('Error parsing menu selections:', e);
      selections = [];
    }
    setFormData({
      customer_id: order.customer_id,
      booking_type: 'Short Order',
      event_datetime: order.event_datetime ? new Date(order.event_datetime).toISOString().slice(0, 16) : '',
      venue: order.venue || '',
      pax_count: order.pax_count?.toString() || '',
      notes: order.notes || '',
      total_amount: order.total_amount?.toString() || '0',
      delivery_fee: order.delivery_fee?.toString() || '0',
      menu_selections: selections,
    });
    setTempItem({ menu_item_id: '', quantity: 1 });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    setFormData({
      customer_id: '',
      booking_type: 'Short Order',
      event_datetime: '',
      venue: '',
      pax_count: '',
      notes: '',
      total_amount: '0',
      delivery_fee: '0',
      menu_selections: [],
    });
    setTempItem({ menu_item_id: '', quantity: 1 });
    setIsSubmitting(false);
  };

  // --- CRUD ---
  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (formData.menu_selections.length === 0) {
        toast.error('Please add at least one menu item.');
        setIsSubmitting(false);
        return;
      }

      const payload = {
        customer_id: formData.customer_id,
        booking_type: 'Short Order',
        event_datetime: formData.event_datetime ? new Date(formData.event_datetime).toISOString() : null,
        venue: formData.venue || null,
        pax_count: parseInt(formData.pax_count) || 0,
        notes: formData.notes || null,
        total_amount: parseFloat(formData.total_amount) || 0,
        delivery_fee: parseFloat(formData.delivery_fee) || 0,
        booking_status: editingId ? undefined : 'Pending',
        menu_selections: formData.menu_selections,
      };

      if (editingId) {
        const { error } = await supabase
          .from('booking')
          .update(payload)
          .eq('booking_id', editingId);
        if (error) throw error;
        toast.success('Short order updated successfully!');
      } else {
        const { error } = await supabase
          .from('booking')
          .insert([payload]);
        if (error) throw error;
        toast.success('Short order created successfully!');
      }
      closeModal();
      fetchData();
    } catch (error) {
      handleError(error, 'Failed to save short order.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- Approval modal logic ---
  const openApprovalModal = (order) => {
    setApprovalOrder(order);
    setApprovalData({
      extraQuantity: 0,
      additionalFee: 0,
      extraDeliveryFee: 0,
      newTotal: order.total_amount || 0,
      baseTotal: order.total_amount || 0,
    });
    setIsApprovalModalOpen(true);
  };

  const handleApprovalInputChange = (e) => {
    const { name, value } = e.target;
    const numValue = parseFloat(value) || 0;
    setApprovalData(prev => {
      const updated = { ...prev, [name]: numValue };
      const newTotal = updated.baseTotal + updated.extraQuantity + updated.additionalFee + updated.extraDeliveryFee;
      return { ...updated, newTotal };
    });
  };

  const handleFinalizeApproval = async () => {
    if (!approvalOrder) return;
    setIsSubmitting(true);
    try {
      const newTotal = approvalData.newTotal;
      const newDeliveryFee = parseFloat(approvalOrder.delivery_fee || 0) + approvalData.extraDeliveryFee;

      const { error: updateError } = await supabase
        .from('booking')
        .update({
          booking_status: 'Approved',
          total_amount: newTotal,
          delivery_fee: newDeliveryFee,
        })
        .eq('booking_id', approvalOrder.booking_id);

      if (updateError) throw updateError;

      setIsApprovalModalOpen(false);
      fetchData();
      toast.success('Short order approved successfully!');
    } catch (error) {
      handleError(error, 'Failed to approve short order.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- Handlers (reject, delete, mark completed) ---
  const handleReject = async (id) => {
    if (!confirm('Reject this order?')) return;
    try {
      const { error } = await supabase
        .from('booking')
        .update({ booking_status: 'Rejected' })
        .eq('booking_id', id);
      if (error) throw error;
      toast.success('Order rejected.');
      fetchData();
    } catch (error) {
      handleError(error, 'Failed to reject order.');
    }
  };

  const handleMarkCompleted = async (id) => {
    if (!confirm('Mark this order as completed?')) return;
    try {
      const { error } = await supabase
        .from('booking')
        .update({ booking_status: 'Completed' })
        .eq('booking_id', id);
      if (error) throw error;
      toast.success('Order marked as completed!');
      fetchData();
    } catch (error) {
      handleError(error, 'Failed to update status.');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this order? This cannot be undone.')) return;
    try {
      const { error } = await supabase
        .from('booking')
        .delete()
        .eq('booking_id', id);
      if (error) throw error;
      toast.success('Order deleted.');
      fetchData();
    } catch (error) {
      handleError(error, 'Failed to delete order.');
    }
  };

  // --- Filter and status helpers ---
  const tabs = ['All', 'Pending', 'Approved', 'Completed', 'Rejected'];
  const filtered = orders.filter(o => {
    if (activeTab !== 'All' && o.booking_status !== activeTab) return false;
    if (searchTerm) {
      const name = `${o.customer?.first_name || ''} ${o.customer?.last_name || ''}`.toLowerCase();
      return name.includes(searchTerm.toLowerCase()) || o.booking_id.toLowerCase().includes(searchTerm.toLowerCase());
    }
    return true;
  });

  const getStatusBadge = (status) => {
    const map = {
      Pending: 'bg-amber-50 border-amber-200 text-amber-700',
      Approved: 'bg-[#EAF3F2] border-[#C1DEDC] text-slate-800',
      Completed: 'bg-blue-50 border-blue-200 text-blue-700',
      Rejected: 'bg-red-50 border-red-200 text-red-700',
    };
    return map[status] || 'bg-slate-100 text-slate-600';
  };

  return (
    <div className="space-y-6 relative">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Short Orders</h1>
          <p className="text-sm text-slate-500">Manage food tray orders (pickup/delivery)</p>
        </div>
        <button onClick={openNewModal} className="bg-[#008A45] hover:bg-[#007038] text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 text-sm shadow-sm">
          + New Short Order
        </button>
      </div>

      {/* Tabs */}
      <div className="flex space-x-6 border-b border-slate-200 overflow-x-auto">
        {tabs.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} className={`pb-3 text-sm font-semibold transition-colors border-b-2 shrink-0 ${activeTab === tab ? 'border-[#008A45] text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {tab}
          </button>
        ))}
      </div>

      {/* Search & Refresh */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <input type="text" placeholder="Search by client..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full border border-slate-300 rounded-lg py-2.5 pl-4 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] bg-white" />
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
        </div>
        <button onClick={fetchData} className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 shadow-xs">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#EAF3F2] text-slate-800 text-sm border-b border-slate-200">
                <th className="p-4 font-bold">Client</th>
                <th className="p-4 font-bold">Venue</th>
                <th className="p-4 font-bold">Pax</th>
                <th className="p-4 font-bold">Amount</th>
                <th className="p-4 font-bold">Status</th>
                <th className="p-4 font-bold text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="6" className="p-6 text-center text-slate-400">Loading short orders...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan="6" className="p-6 text-center text-slate-500 italic">No short orders found.</td></tr>
              ) : (
                filtered.map(order => (
                  <tr key={order.booking_id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-4">
                      <p onClick={() => navigate(`/app/orders/${order.booking_id}`)} className="font-bold text-slate-900 underline decoration-slate-300 underline-offset-4 cursor-pointer hover:text-[#008A45]">
                        {order.customer?.first_name} {order.customer?.last_name}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">{order.event_datetime ? new Date(order.event_datetime).toLocaleDateString() : 'No date'}</p>
                    </td>
                    <td className="p-4">{order.venue || 'N/A'}</td>
                    <td className="p-4">{order.pax_count || 0}</td>
                    <td className="p-4 font-bold text-slate-900">₱{order.total_amount?.toLocaleString() || '0'}</td>
                    <td className="p-4">
                      <span className={`px-3 py-1.5 rounded-full text-xs font-bold border ${getStatusBadge(order.booking_status)}`}>
                        {order.booking_status}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center justify-center gap-2 flex-wrap">
                        {order.booking_status === 'Pending' && (
                          <>
                            <button
                              onClick={() => openApprovalModal(order)}
                              className="bg-[#C1DEDC] border border-[#a8cfcc] text-slate-800 font-semibold text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1 hover:bg-[#b8dad7]"
                            >
                              <Check size={14} /> Approve
                            </button>
                            <button
                              onClick={() => handleReject(order.booking_id)}
                              className="bg-red-100 border border-red-200 text-red-700 font-semibold text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1 hover:bg-red-200"
                            >
                              <X size={14} /> Reject
                            </button>
                          </>
                        )}
                        {order.booking_status === 'Approved' && (
                          <button
                            onClick={() => handleMarkCompleted(order.booking_id)}
                            className="bg-blue-100 border border-blue-200 text-blue-700 font-semibold text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1 hover:bg-blue-200"
                          >
                            <Check size={14} /> Mark Completed
                          </button>
                        )}
                        <button onClick={() => navigate(`/app/orders/${order.booking_id}`)} className="bg-white border border-slate-300 text-slate-700 font-semibold text-xs px-3 py-1.5 rounded-lg hover:bg-slate-50">
                          Details
                        </button>
                        <button onClick={() => openEditModal(order)} className="text-slate-400 hover:text-slate-700 p-1"><Edit size={16} /></button>
                        <button onClick={() => handleDelete(order.booking_id)} className="text-red-400 hover:text-red-600 p-1"><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="p-4 border-t border-slate-200 flex justify-between items-center bg-white text-sm text-slate-600">
          <span>Showing {filtered.length} of {orders.length} orders</span>
          <div className="flex items-center gap-1">
            <button className="p-1 text-slate-400 hover:text-slate-800"><ChevronLeft size={16} /></button>
            <button className="w-7 h-7 flex items-center justify-center rounded bg-[#008A45] text-white font-bold">1</button>
            <button className="p-1 text-slate-400 hover:text-slate-800"><ChevronRight size={16} /></button>
          </div>
        </div>
      </div>

      {/* ========== NEW/EDIT SHORT ORDER MODAL ========== */}
      {isModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0">
              <h2 className="text-lg font-bold text-slate-900">{editingId ? 'Edit Short Order' : 'New Short Order'}</h2>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1"><X size={18} /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5 text-left">
              {/* Customer */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Customer *</label>
                <select name="customer_id" value={formData.customer_id} onChange={handleInputChange} required className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]">
                  <option value="">Select Customer</option>
                  {customers.map(c => <option key={c.customer_id} value={c.customer_id}>{c.first_name} {c.last_name}</option>)}
                </select>
              </div>

              {/* Event Date & Time */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Event Date & Time</label>
                <input type="datetime-local" name="event_datetime" value={formData.event_datetime} onChange={handleInputChange} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]" />
              </div>

              {/* Venue */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Venue / Location</label>
                <input type="text" name="venue" value={formData.venue} onChange={handleInputChange} placeholder="e.g. Pick-up or Delivery address" className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]" />
              </div>

              {/* Pax & Delivery Fee */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Pax Count</label>
                  <input type="number" name="pax_count" value={formData.pax_count} onChange={handleInputChange} placeholder="e.g. 20" className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Delivery Fee</label>
                  <input type="number" name="delivery_fee" value={formData.delivery_fee} onChange={handleInputChange} placeholder="0.00" className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]" />
                </div>
              </div>

              {/* Menu Item Selection */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Select Menu Items</label>
                <div className="flex gap-2 mb-2">
                  <select
                    name="menu_item_id"
                    value={tempItem.menu_item_id}
                    onChange={handleTempItemChange}
                    className="flex-1 border border-slate-300 rounded-lg p-2 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                  >
                    <option value="">Choose item...</option>
                    {menuItems.map(item => (
                      <option key={item.menu_item_id} value={item.menu_item_id}>
                        {item.menu_name} (₱{item.menu_price})
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    name="quantity"
                    min="1"
                    value={tempItem.quantity}
                    onChange={handleTempItemChange}
                    className="w-20 border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                    placeholder="Qty"
                  />
                  <button
                    type="button"
                    onClick={addItemToSelection}
                    className="bg-[#008A45] hover:bg-[#007038] text-white px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1"
                  >
                    <Plus size={16} /> Add
                  </button>
                </div>
                <div className="border border-slate-200 rounded-lg p-3 min-h-[80px] space-y-1.5 bg-slate-50">
                  {formData.menu_selections.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">No items added yet.</p>
                  ) : (
                    formData.menu_selections.map((item, idx) => {
                      const menuItem = menuItems.find(m => m.menu_item_id === item.menu_item_id);
                      const subtotal = menuItem ? menuItem.menu_price * item.quantity : 0;
                      return (
                        <div key={idx} className="flex items-center justify-between bg-white border border-slate-200 rounded px-3 py-1.5 text-sm">
                          <span className="font-medium text-slate-700">
                            {menuItem?.menu_name || 'Unknown'} × {item.quantity}
                            <span className="text-xs text-slate-500 ml-2">₱{subtotal.toFixed(2)}</span>
                          </span>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) => updateItemQuantity(item.menu_item_id, e.target.value)}
                              className="w-14 border border-slate-300 rounded p-0.5 text-sm text-center"
                            />
                            <button
                              type="button"
                              onClick={() => removeItemFromSelection(item.menu_item_id)}
                              className="text-red-500 hover:text-red-700 text-xs font-bold"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-1">Add at least one menu item.</p>
              </div>

              {/* Total Amount (auto-calculated, read-only) */}
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                <label className="block text-xs font-bold text-slate-700 mb-1">Total Amount</label>
                <div className="text-xl font-bold text-[#008A45]">₱{formData.total_amount || '0.00'}</div>
                <input type="hidden" name="total_amount" value={formData.total_amount} />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Notes (optional)</label>
                <textarea name="notes" value={formData.notes} onChange={handleInputChange} rows="2" placeholder="Special instructions..." className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45] resize-none" />
              </div>

              {/* Footer */}
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button type="button" onClick={closeModal} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-50">
                  {isSubmitting ? 'Saving...' : editingId ? 'Update' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ========== APPROVAL MODAL ========== */}
      {isApprovalModalOpen && approvalOrder && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0">
              <h2 className="text-lg font-bold text-slate-900">Approve Short Order – Adjust Fees</h2>
              <button
                onClick={() => setIsApprovalModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-6 text-left">
              {/* Order summary */}
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <span className="font-medium text-slate-600">Customer:</span>
                  <span className="font-bold text-slate-900">
                    {approvalOrder.customer?.first_name} {approvalOrder.customer?.last_name}
                  </span>
                  <span className="font-medium text-slate-600">Venue:</span>
                  <span className="font-bold text-slate-900">{approvalOrder.venue || 'N/A'}</span>
                  <span className="font-medium text-slate-600">Current Total:</span>
                  <span className="font-bold text-slate-900">₱{approvalOrder.total_amount?.toLocaleString() || '0'}</span>
                </div>
                <p className="text-xs text-slate-500 mt-2">Short order pricing is per unit (per pax or per kilo). You can add extra fees below.</p>
              </div>

              {/* Adjustment fields */}
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Extra Quantity Fee (additional servings/items)</label>
                  <input
                    type="number"
                    name="extraQuantity"
                    min="0"
                    step="0.01"
                    value={approvalData.extraQuantity}
                    onChange={handleApprovalInputChange}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                    placeholder="e.g. 1000"
                  />
                  <p className="text-xs text-slate-400 mt-1">Enter the total additional cost for extra quantity.</p>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Additional Delivery Fee</label>
                  <input
                    type="number"
                    name="extraDeliveryFee"
                    min="0"
                    step="0.01"
                    value={approvalData.extraDeliveryFee}
                    onChange={handleApprovalInputChange}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                    placeholder="e.g. 500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Other Fees (add-ons, special requests)</label>
                  <input
                    type="number"
                    name="additionalFee"
                    min="0"
                    step="0.01"
                    value={approvalData.additionalFee}
                    onChange={handleApprovalInputChange}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                    placeholder="e.g. 2000"
                  />
                </div>
              </div>

              {/* New total display */}
              <div className="bg-[#EAF3F2] border border-[#d2e8e5] rounded-lg p-4 flex justify-between items-center">
                <span className="font-bold text-slate-800">New Total:</span>
                <span className="text-xl font-extrabold text-[#008A45]">₱{approvalData.newTotal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
              </div>
              <div className="text-sm text-slate-500">
                <p>Down payment (50%): <span className="font-bold">₱{(approvalData.newTotal * 0.5).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span></p>
                <p className="text-xs mt-1">* Down payment may be required for large orders (subject to business policy).</p>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsApprovalModalOpen(false)}
                  className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleFinalizeApproval}
                  disabled={isSubmitting}
                  className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? 'Approving...' : 'Confirm Approval & Update Total'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}