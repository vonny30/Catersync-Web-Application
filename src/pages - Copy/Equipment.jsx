// pages/Equipment.jsx
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Edit, Trash2, X, CheckCircle, Settings, ClipboardList, RefreshCw, Undo2, Calendar, MapPin, Users, Clock } from 'lucide-react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';

export default function Equipment() {
  const { showConfirm } = useConfirm();
  // --- DATA STATE ---
  const [equipmentList, setEquipmentList] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // --- USAGE MODAL ---
  const [isUsageModalOpen, setIsUsageModalOpen] = useState(false);
  const [selectedEquipment, setSelectedEquipment] = useState(null);
  const [equipmentUsage, setEquipmentUsage] = useState([]);

  // --- MODAL STATES ---
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);

  // --- FORM STATES ---
  const [addFormData, setAddFormData] = useState({
    equipmentName: '',
    quantity: 0,
    description: '',
    condition: 'Good Condition'
  });

  const [editFormData, setEditFormData] = useState({
    equipment_id: '',
    eqm_name: '',
    quantity_available: 0,
    eqm_description: '',
    eqm_status: 'Good Condition'
  });

  const [assignFormData, setAssignFormData] = useState({
    booking_id: '',
    notes: ''
  });

  // --- MULTIPLE ASSIGNMENT QUEUE ---
  const [assignmentQueue, setAssignmentQueue] = useState([]);
  const [tempEquipId, setTempEquipId] = useState('');
  const [tempQuantity, setTempQuantity] = useState(1);

  // --- Helper: Log technical error and show user-friendly toast ---
  const handleError = (error, userMessage = 'Something went wrong. Please try again.') => {
    console.error('Error:', error);
    toast.error(userMessage);
  };

  // --- FETCH DATA ---
  const fetchData = async () => {
    setIsLoading(true);
    try {
      const { data: equipData, error: equipError } = await supabase
        .from('equipment')
        .select('*')
        .order('eqm_name');
      if (equipError) throw equipError;
      setEquipmentList(equipData || []);

      const { data: bookingData, error: bookingError } = await supabase
        .from('booking')
        .select(`
          booking_id,
          booking_type,
          booking_status,
          event_datetime,
          venue,
          pax_count,
          notes,
          customer:customer_id (first_name, last_name, contact_no, cus_address)
        `)
        .eq('booking_type', 'Package')
        .in('booking_status', ['Approved', 'Pending'])
        .order('event_datetime', { ascending: true });
      if (bookingError) throw bookingError;
      setBookings(bookingData || []);

      const { data: assignData, error: assignError } = await supabase
        .from('booking_equipment')
        .select(`
          *,
          booking:booking_id (
            booking_id,
            venue,
            customer:customer_id (first_name, last_name)
          ),
          equipment:equipment_id (eqm_name)
        `)
        .order('assigned_at', { ascending: false });
      if (assignError) throw assignError;
      setAssignments(assignData || []);

    } catch (error) {
      handleError(error, 'Unable to load equipment data. Please refresh the page.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // --- FETCH EQUIPMENT USAGE ---
  const fetchEquipmentUsage = async (equipmentId) => {
    try {
      const { data, error } = await supabase
        .from('booking_equipment')
        .select(`
          *,
          booking:booking_id (
            booking_id,
            venue,
            event_datetime,
            customer:customer_id (first_name, last_name)
          )
        `)
        .eq('equipment_id', equipmentId)
        .order('assigned_at', { ascending: false });

      if (error) throw error;
      setEquipmentUsage(data || []);
    } catch (error) {
      console.error('Error fetching usage:', error);
      setEquipmentUsage([]);
      toast.error('Unable to load usage history.');
    }
  };

  // --- Get selected booking details ---
  const selectedBooking = bookings.find(b => b.booking_id === assignFormData.booking_id);

  // --- HANDLERS ---
  const handleAddInputChange = (e) => {
    const { name, value } = e.target;
    setAddFormData(prev => ({
      ...prev,
      [name]: name === 'quantity' ? parseInt(value) || 0 : value
    }));
  };

  const handleEditInputChange = (e) => {
    const { name, value } = e.target;
    setEditFormData(prev => ({
      ...prev,
      [name]: name === 'quantity_available' ? parseInt(value) || 0 : value
    }));
  };

  const handleAssignInputChange = (e) => {
    const { name, value } = e.target;
    setAssignFormData(prev => ({ ...prev, [name]: value }));
  };

  // --- ADD EQUIPMENT ---
  const handleAddEquipment = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const { error } = await supabase
        .from('equipment')
        .insert([{
          eqm_name: addFormData.equipmentName,
          eqm_description: addFormData.description || 'No description',
          quantity_available: addFormData.quantity,
          eqm_status: addFormData.condition
        }]);

      if (error) throw error;

      setIsAddModalOpen(false);
      setAddFormData({ equipmentName: '', quantity: 0, description: '', condition: 'Good Condition' });
      toast.success('Equipment added successfully!');
      await fetchData();
    } catch (error) {
      handleError(error, 'Failed to add equipment.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- EDIT EQUIPMENT ---
  const handleEditClick = (item) => {
    setEditFormData({
      equipment_id: item.equipment_id,
      eqm_name: item.eqm_name,
      quantity_available: item.quantity_available,
      eqm_description: item.eqm_description || '',
      eqm_status: item.eqm_status || 'Good Condition'
    });
    setIsEditModalOpen(true);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const { error } = await supabase
        .from('equipment')
        .update({
          eqm_name: editFormData.eqm_name,
          eqm_description: editFormData.eqm_description,
          quantity_available: editFormData.quantity_available,
          eqm_status: editFormData.eqm_status
        })
        .eq('equipment_id', editFormData.equipment_id);

      if (error) throw error;

      setIsEditModalOpen(false);
      toast.success('Equipment updated successfully!');
      await fetchData();
    } catch (error) {
      handleError(error, 'Failed to update equipment.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- DELETE EQUIPMENT ---
  const handleDeleteEquipment = async (id) => {
    const confirmed = await showConfirm({
      title: 'Delete Equipment?',
      message: 'Are you sure you want to delete this equipment? This action cannot be undone.',
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from('equipment')
        .delete()
        .eq('equipment_id', id);

      if (error) throw error;
      toast.success('Equipment deleted.');
      await fetchData();
    } catch (error) {
      handleError(error, 'Failed to delete equipment. It may be in use.');
    }
  };

  // --- QUEUE FUNCTIONS ---
  const addToQueue = () => {
    if (!tempEquipId) {
      toast.error('Please select equipment.');
      return;
    }
    if (tempQuantity < 1) {
      toast.error('Quantity must be at least 1.');
      return;
    }
    const existing = assignmentQueue.find(item => item.equipment_id === tempEquipId);
    if (existing) {
      toast.error('This equipment is already in the list. Remove it first if you want to change quantity.');
      return;
    }
    const equip = equipmentList.find(e => e.equipment_id === tempEquipId);
    if (!equip) {
      toast.error('Equipment not found.');
      return;
    }
    if (tempQuantity > equip.quantity_available) {
      toast.error(`Not enough stock! Only ${equip.quantity_available} available.`);
      return;
    }
    setAssignmentQueue([...assignmentQueue, { equipment_id: tempEquipId, quantity: tempQuantity }]);
    setTempEquipId('');
    setTempQuantity(1);
  };

  const removeFromQueue = (equipment_id) => {
    setAssignmentQueue(assignmentQueue.filter(item => item.equipment_id !== equipment_id));
  };

  // --- ASSIGN EQUIPMENT (Multiple) ---
  const handleAssignSubmit = async (e) => {
    e.preventDefault();
    if (assignmentQueue.length === 0) {
      toast.error('Please add at least one equipment to assign.');
      return;
    }
    if (!assignFormData.booking_id) {
      toast.error('Please select a booking.');
      return;
    }

    setIsSubmitting(true);

    try {
      // Validate all items have enough stock
      const itemsToAssign = assignmentQueue.map(item => {
        const equip = equipmentList.find(e => e.equipment_id === item.equipment_id);
        if (!equip) throw new Error(`Equipment ${item.equipment_id} not found.`);
        if (item.quantity > equip.quantity_available) {
          throw new Error(`Not enough stock for ${equip.eqm_name}. Needed ${item.quantity}, only ${equip.quantity_available} available.`);
        }
        return { ...item, equip };
      });

      // Insert all assignments and update stock
      for (const item of itemsToAssign) {
        // Check if this equipment is already assigned to this booking
        const existingAssign = assignments.find(
          a => a.booking_id === assignFormData.booking_id && a.equipment_id === item.equipment_id && !a.returned
        );
        if (existingAssign) {
          throw new Error(`Equipment ${item.equip.eqm_name} is already assigned to this booking. Please return it first.`);
        }

        // Insert assignment
        const { error: insertError } = await supabase
          .from('booking_equipment')
          .insert([{
            booking_id: assignFormData.booking_id,
            equipment_id: item.equipment_id,
            quantity: item.quantity,
            notes: assignFormData.notes || null,
            returned: false
          }]);
        if (insertError) throw insertError;

        // Update stock
        const newQuantity = item.equip.quantity_available - item.quantity;
        const { error: updateError } = await supabase
          .from('equipment')
          .update({ quantity_available: newQuantity })
          .eq('equipment_id', item.equipment_id);
        if (updateError) throw updateError;
      }

      setAssignmentQueue([]);
      setIsAssignModalOpen(false);
      setAssignFormData({ booking_id: '', notes: '' });
      toast.success(`Successfully assigned ${itemsToAssign.length} equipment items.`);
      await fetchData();
    } catch (error) {
      handleError(error, error.message || 'Failed to assign equipment.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- RETURN EQUIPMENT ---
  const handleReturnEquipment = async (assignmentId, equipmentId, quantity) => {
    const confirmed = await showConfirm({
      title: 'Return Equipment?',
      message: 'Are you sure you want to mark this equipment as returned? This will restore the quantity to inventory.',
      confirmLabel: 'Return',
      confirmVariant: 'success',
    });
    if (!confirmed) return;

    try {
      const { error: updateAssignError } = await supabase
        .from('booking_equipment')
        .update({ returned: true, returned_at: new Date().toISOString() })
        .eq('assignment_id', assignmentId);
      if (updateAssignError) throw updateAssignError;

      const { data: equipData, error: fetchError } = await supabase
        .from('equipment')
        .select('quantity_available')
        .eq('equipment_id', equipmentId)
        .single();
      if (fetchError) throw fetchError;

      const newQuantity = equipData.quantity_available + quantity;
      const { error: updateEquipError } = await supabase
        .from('equipment')
        .update({ quantity_available: newQuantity })
        .eq('equipment_id', equipmentId);
      if (updateEquipError) throw updateEquipError;

      toast.success('Equipment returned successfully!');
      await fetchData();
    } catch (error) {
      handleError(error, 'Failed to return equipment.');
    }
  };

  // --- VIEW USAGE ---
  const handleViewUsage = async (item) => {
    setSelectedEquipment(item);
    await fetchEquipmentUsage(item.equipment_id);
    setIsUsageModalOpen(true);
  };

  // --- CALCULATE STATS ---
  const totalItems = equipmentList.reduce((sum, eq) => sum + eq.quantity_available, 0);
  const damagedItems = equipmentList.filter(eq => eq.eqm_status === 'Damaged').length;
  const activeAssignments = assignments.filter(a => !a.returned).length;

  // --- RENDER ---
  return (
    <div className="space-y-6 relative pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Equipment</h1>
          <p className="text-sm text-slate-500">Monitor inventory, assign equipment, and view usage</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 px-4 py-2.5 rounded-lg font-semibold transition-colors flex items-center gap-2 text-sm shadow-xs cursor-pointer"
          >
            <Settings size={16} /> Add Stock
          </button>
          <button
            onClick={() => { setAssignmentQueue([]); setIsAssignModalOpen(true); }}
            className="bg-[#008A45] hover:bg-[#007038] text-white px-4 py-2.5 rounded-lg font-semibold transition-colors flex items-center gap-2 text-sm shadow-sm cursor-pointer"
          >
            <ClipboardList size={16} /> Assign Equipment
          </button>
          <button
            onClick={fetchData}
            className="bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 px-3 py-2.5 rounded-lg font-semibold transition-colors flex items-center gap-2 text-sm shadow-xs"
          >
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-[#CBDEDD]/60 border border-[#b4d2d0] rounded-xl p-5 text-center">
          <p className="text-xs font-semibold text-slate-600 mb-1">Total Items</p>
          <h3 className="text-3xl font-extrabold text-slate-900">{totalItems}</h3>
        </div>
        <div className="bg-[#CBDEDD]/60 border border-[#b4d2d0] rounded-xl p-5 text-center">
          <p className="text-xs font-semibold text-slate-600 mb-1">Equipment Types</p>
          <h3 className="text-3xl font-extrabold text-slate-900">{equipmentList.length}</h3>
        </div>
        <div className="bg-[#CBDEDD]/60 border border-[#b4d2d0] rounded-xl p-5 text-center">
          <p className="text-xs font-semibold text-slate-600 mb-1">Active Assignments</p>
          <h3 className="text-3xl font-extrabold text-[#008A45]">{activeAssignments}</h3>
        </div>
        <div className="bg-[#CBDEDD]/60 border border-[#b4d2d0] rounded-xl p-5 text-center">
          <p className="text-xs font-semibold text-slate-600 mb-1">Damaged</p>
          <h3 className="text-3xl font-extrabold text-red-600">{damagedItems}</h3>
        </div>
      </div>

      {/* Equipment Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-200 font-bold text-sm text-slate-800">
          Equipment Inventory
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#EAF3F2] text-slate-800 text-sm border-b border-slate-200">
                <th className="p-4 font-bold">Equipment</th>
                <th className="p-4 font-bold text-center">Available</th>
                <th className="p-4 font-bold text-center">Condition</th>
                <th className="p-4 font-bold text-center">Usage</th>
                <th className="p-4 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm text-slate-700">
              {isLoading ? (
                <tr>
                  <td colSpan="5" className="p-6 text-center text-slate-400">Loading equipment...</td>
                </tr>
              ) : equipmentList.length === 0 ? (
                <tr>
                  <td colSpan="5" className="p-6 text-center text-slate-400 italic">No equipment found.</td>
                </tr>
              ) : (
                equipmentList.map((item) => {
                  const usageCount = assignments.filter(a => a.equipment_id === item.equipment_id && !a.returned).length;
                  return (
                    <tr key={item.equipment_id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-4">
                        <p className="font-bold text-slate-900">{item.eqm_name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{item.eqm_description}</p>
                      </td>
                      <td className="p-4 text-center font-semibold text-slate-900">{item.quantity_available}</td>
                      <td className="p-4 text-center">
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold 
                          ${item.eqm_status === 'Good Condition' ? 'bg-[#CBDEDD]/60 border-[#a3c7c4] text-slate-800' : 
                            item.eqm_status === 'Damaged' ? 'bg-red-50 border-red-200 text-red-600' :
                            'bg-yellow-50 border-yellow-200 text-yellow-700'}`}
                        >
                          <CheckCircle size={12} className={item.eqm_status === 'Good Condition' ? 'text-[#008A45]' : 'text-slate-400'} />
                          {item.eqm_status}
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        <button
                          onClick={() => handleViewUsage(item)}
                          className="text-blue-500 hover:text-blue-700 transition-colors text-xs font-medium flex items-center gap-1 mx-auto"
                        >
                          <ClipboardList size={14} />
                          {usageCount > 0 ? `${usageCount} in use` : 'No usage'}
                        </button>
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <button 
                            onClick={() => handleEditClick(item)}
                            className="text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
                            title="Edit Equipment"
                          >
                            <Edit size={16} />
                          </button>
                          <button
                            onClick={() => handleDeleteEquipment(item.equipment_id)}
                            className="text-red-400 hover:text-red-600 transition-colors cursor-pointer"
                            title="Delete Equipment"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Active Assignments Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-200 font-bold text-sm text-slate-800 flex justify-between items-center">
          <span>Active Equipment Assignments</span>
          <span className="text-xs font-normal text-slate-500">{activeAssignments} active</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#EAF3F2] text-slate-800 text-sm border-b border-slate-200">
                <th className="p-4 font-bold">Client</th>
                <th className="p-4 font-bold">Booking</th>
                <th className="p-4 font-bold">Equipment</th>
                <th className="p-4 font-bold text-center">Qty</th>
                <th className="p-4 font-bold">Assigned At</th>
                <th className="p-4 font-bold text-center">Status</th>
                <th className="p-4 font-bold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm text-slate-700">
              {isLoading ? (
                <tr><td colSpan="7" className="p-6 text-center text-slate-400">Loading assignments...</td></tr>
              ) : assignments.filter(a => !a.returned).length === 0 ? (
                <tr><td colSpan="7" className="p-6 text-center text-slate-400 italic">No active assignments.</td></tr>
              ) : (
                assignments.filter(a => !a.returned).map((assign) => (
                  <tr key={assign.assignment_id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-4 font-bold text-slate-900">
                      {assign.booking?.customer ? `${assign.booking.customer.first_name} ${assign.booking.customer.last_name}` : 'Unknown'}
                    </td>
                    <td className="p-4 text-slate-600">{assign.booking?.booking_id?.slice(0, 8) || 'N/A'}</td>
                    <td className="p-4 font-medium text-slate-800">{assign.equipment?.eqm_name || 'Unknown'}</td>
                    <td className="p-4 text-center font-bold text-[#008A45]">{assign.quantity}</td>
                    <td className="p-4 text-slate-600">
                      {assign.assigned_at ? new Date(assign.assigned_at).toLocaleDateString() : 'N/A'}
                    </td>
                    <td className="p-4 text-center">
                      <span className="px-2 py-1 bg-amber-50 border border-amber-200 text-amber-700 rounded-full text-xs font-medium">
                        Assigned
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <button
                        onClick={() => handleReturnEquipment(assign.assignment_id, assign.equipment_id, assign.quantity)}
                        className="text-blue-500 hover:text-blue-700 transition-colors cursor-pointer flex items-center gap-1 text-sm font-medium"
                      >
                        <Undo2 size={16} /> Return
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ========================================================= */}
      {/* ADD EQUIPMENT MODAL */}
      {/* ========================================================= */}
      {isAddModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Add New Equipment</h2>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAddEquipment} className="p-6 space-y-5 text-left">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Equipment Name</label>
                  <input
                    type="text"
                    name="equipmentName"
                    value={addFormData.equipmentName}
                    onChange={handleAddInputChange}
                    placeholder="e.g. Infinity Chairs"
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none font-medium text-slate-800"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Quantity</label>
                  <input
                    type="number"
                    name="quantity"
                    min="1"
                    value={addFormData.quantity}
                    onChange={handleAddInputChange}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Condition</label>
                <select
                  name="condition"
                  value={addFormData.condition}
                  onChange={handleAddInputChange}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                >
                  <option value="Good Condition">Good Condition</option>
                  <option value="Damaged">Damaged</option>
                  <option value="Under Maintenance">Under Maintenance</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Description</label>
                <textarea
                  name="description"
                  rows="3"
                  placeholder="Type description..."
                  value={addFormData.description}
                  onChange={handleAddInputChange}
                  className="w-full border border-slate-300 rounded-lg p-3 text-sm text-slate-700 focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none resize-none"
                />
              </div>
              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button type="button" onClick={() => setIsAddModalOpen(false)} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2 rounded-lg border border-slate-300 transition-colors cursor-pointer">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm cursor-pointer disabled:opacity-50">
                  {isSubmitting ? 'Adding...' : 'Add Equipment'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ========================================================= */}
      {/* EDIT EQUIPMENT MODAL */}
      {/* ========================================================= */}
      {isEditModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Edit Equipment</h2>
              <button onClick={() => setIsEditModalOpen(false)} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors cursor-pointer"><X size={18} /></button>
            </div>
            <form onSubmit={handleEditSubmit} className="p-6 space-y-5 text-left">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Equipment Name</label>
                  <input type="text" name="eqm_name" value={editFormData.eqm_name} onChange={handleEditInputChange} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none font-medium text-slate-800" required />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Quantity</label>
                  <input type="number" name="quantity_available" min="0" value={editFormData.quantity_available} onChange={handleEditInputChange} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none" required />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Condition</label>
                <select name="eqm_status" value={editFormData.eqm_status} onChange={handleEditInputChange} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none">
                  <option value="Good Condition">Good Condition</option>
                  <option value="Damaged">Damaged</option>
                  <option value="Under Maintenance">Under Maintenance</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Description</label>
                <textarea name="eqm_description" rows="3" placeholder="Type description..." value={editFormData.eqm_description} onChange={handleEditInputChange} className="w-full border border-slate-300 rounded-lg p-3 text-sm text-slate-700 focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none resize-none" />
              </div>
              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button type="button" onClick={() => setIsEditModalOpen(false)} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2 rounded-lg border border-slate-300 transition-colors cursor-pointer">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm cursor-pointer disabled:opacity-50">
                  {isSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ========================================================= */}
      {/* ASSIGN EQUIPMENT MODAL - Multiple Assignment */}
      {/* ========================================================= */}
      {isAssignModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Assign Equipment</h2>
                <p className="text-xs text-slate-500">Select a booking and add multiple equipment items</p>
              </div>
              <button
                onClick={() => {
                  setIsAssignModalOpen(false);
                  setAssignmentQueue([]);
                }}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAssignSubmit} className="p-6 overflow-y-auto space-y-5 text-left">
              {/* Booking Selection */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Select Booking</label>
                <select
                  name="booking_id"
                  value={assignFormData.booking_id}
                  onChange={handleAssignInputChange}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none font-medium text-slate-800"
                  required
                >
                  <option value="">Select approved booking...</option>
                  {bookings.map((b) => {
                    const customerName = b.customer ? `${b.customer.first_name} ${b.customer.last_name}` : 'Unknown';
                    const date = b.event_datetime ? new Date(b.event_datetime).toLocaleDateString() : 'No date';
                    return (
                      <option key={b.booking_id} value={b.booking_id}>
                        {b.booking_id.slice(0, 8)} - {customerName} ({date})
                      </option>
                    );
                  })}
                  {bookings.length === 0 && <option disabled>No approved bookings available</option>}
                </select>
              </div>

              {/* Booking Details Preview */}
              {selectedBooking && (
                <div className="bg-[#F8F9FA] border border-slate-200 rounded-lg p-4 space-y-3">
                  <div className="flex justify-between items-start">
                    <h4 className="font-bold text-slate-900 text-sm">Booking Details</h4>
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      selectedBooking.booking_status === 'Approved' ? 'bg-green-100 text-green-700 border border-green-200' :
                      selectedBooking.booking_status === 'Pending' ? 'bg-amber-100 text-amber-700 border border-amber-200' :
                      'bg-slate-100 text-slate-700 border border-slate-200'
                    }`}>
                      {selectedBooking.booking_status}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center gap-2 col-span-2">
                      <Users size={14} className="text-slate-400" />
                      <span className="text-slate-600">Customer:</span>
                      <span className="font-semibold text-slate-900">
                        {selectedBooking.customer ? `${selectedBooking.customer.first_name} ${selectedBooking.customer.last_name}` : 'Unknown'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 col-span-2">
                      <Calendar size={14} className="text-slate-400" />
                      <span className="text-slate-600">Event Date:</span>
                      <span className="font-semibold text-slate-900">
                        {selectedBooking.event_datetime ? new Date(selectedBooking.event_datetime).toLocaleString() : 'N/A'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 col-span-2">
                      <MapPin size={14} className="text-slate-400" />
                      <span className="text-slate-600">Venue:</span>
                      <span className="font-semibold text-slate-900">{selectedBooking.venue || 'N/A'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Users size={14} className="text-slate-400" />
                      <span className="text-slate-600">Pax:</span>
                      <span className="font-semibold text-slate-900">{selectedBooking.pax_count || 0}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-600">Type:</span>
                      <span className="font-semibold text-slate-900">{selectedBooking.booking_type || 'Package'}</span>
                    </div>
                    {selectedBooking.notes && (
                      <div className="col-span-2 text-xs text-slate-500 border-t border-slate-200 pt-2 mt-1">
                        <span className="font-medium text-slate-600">Notes:</span> {selectedBooking.notes}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Add Equipment to Queue */}
              <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Add Equipment to Assignment List</label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <select
                    value={tempEquipId}
                    onChange={(e) => setTempEquipId(e.target.value)}
                    className="flex-1 border border-slate-300 rounded-lg p-2 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                  >
                    <option value="">Select equipment...</option>
                    {equipmentList.map((eq) => (
                      <option key={eq.equipment_id} value={eq.equipment_id} disabled={eq.quantity_available === 0}>
                        {eq.eqm_name} ({eq.quantity_available} available)
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="1"
                    value={tempQuantity}
                    onChange={(e) => setTempQuantity(parseInt(e.target.value) || 1)}
                    className="w-20 border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                  />
                  <button
                    type="button"
                    onClick={addToQueue}
                    className="bg-[#008A45] hover:bg-[#007038] text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1"
                  >
                    <Plus size={16} /> Add
                  </button>
                </div>
                {assignmentQueue.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    <p className="text-xs font-medium text-slate-600">Selected Equipment:</p>
                    {assignmentQueue.map((item) => {
                      const equip = equipmentList.find(e => e.equipment_id === item.equipment_id);
                      return (
                        <div key={item.equipment_id} className="flex items-center justify-between bg-white border border-slate-200 rounded px-3 py-1.5 text-sm">
                          <span className="font-medium text-slate-700">{equip?.eqm_name || 'Unknown'} × {item.quantity}</span>
                          <button
                            type="button"
                            onClick={() => removeFromQueue(item.equipment_id)}
                            className="text-red-500 hover:text-red-700 text-xs font-bold"
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Notes (optional)</label>
                <textarea
                  name="notes"
                  rows="2"
                  placeholder="Any special instructions..."
                  value={assignFormData.notes}
                  onChange={handleAssignInputChange}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm text-slate-700 focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none resize-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    setIsAssignModalOpen(false);
                    setAssignmentQueue([]);
                  }}
                  className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2 rounded-lg border border-slate-300 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Assigning...' : `Assign ${assignmentQueue.length} Item${assignmentQueue.length !== 1 ? 's' : ''}`}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ========================================================= */}
      {/* USAGE MODAL */}
      {/* ========================================================= */}
      {isUsageModalOpen && createPortal(
        <div className="fixed inset-0 z-[9999] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center px-6 py-4 border-b border-slate-200 shrink-0">
              <h3 className="text-lg font-bold text-slate-900">
                Equipment Usage: {selectedEquipment?.eqm_name}
              </h3>
              <button onClick={() => setIsUsageModalOpen(false)} className="text-slate-400 hover:text-slate-600 border border-slate-300 rounded-md p-1 transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {equipmentUsage.length === 0 ? (
                <p className="text-sm text-slate-500 italic text-center py-8">No usage records found.</p>
              ) : (
                <div className="space-y-3">
                  {equipmentUsage.map(record => {
                    const booking = record.booking;
                    const customerName = booking?.customer 
                      ? `${booking.customer.first_name} ${booking.customer.last_name}` 
                      : 'Unknown';
                    return (
                      <div key={record.assignment_id} className={`border rounded-lg p-3 flex justify-between items-center ${record.returned ? 'bg-slate-50 border-slate-200' : 'bg-amber-50 border-amber-200'}`}>
                        <div>
                          <p className="font-bold text-slate-900 text-sm">{customerName}</p>
                          <p className="text-xs text-slate-500">{booking?.venue || 'No venue'} · {booking?.event_datetime ? new Date(booking.event_datetime).toLocaleDateString() : 'N/A'}</p>
                          <p className="text-xs text-slate-500">Booking: {booking?.booking_id?.slice(0, 8) || 'N/A'} · Quantity: <span className="font-bold text-[#008A45]">{record.quantity}</span></p>
                        </div>
                        <div className="text-right">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${record.returned ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                            {record.returned ? '✅ Returned' : '📌 Assigned'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}