// src/pages/Equipment.jsx
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Edit, Trash2, X, CheckCircle, Settings, ClipboardList, RefreshCw, Undo2, Calendar, MapPin, Users, Clock } from 'lucide-react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';

export default function Equipment() {
  const { showConfirm } = useConfirm();

  // --- STATE ---
  const [equipmentList, setEquipmentList] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [isUsageModalOpen, setIsUsageModalOpen] = useState(false);
  const [selectedEquipment, setSelectedEquipment] = useState(null);
  const [equipmentUsage, setEquipmentUsage] = useState([]);

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);

  // --- Equipment Detail Modal State (for clickable cards) ---
  const [isEquipmentModalOpen, setIsEquipmentModalOpen] = useState(false);
  const [equipmentModalData, setEquipmentModalData] = useState([]);
  const [equipmentModalTitle, setEquipmentModalTitle] = useState('');

  const [addFormData, setAddFormData] = useState({
    equipmentName: '',
    quantity: 0,
    damagedQuantity: 0,
    maintenanceQuantity: 0,
    description: '',
    condition: 'Good Condition',
    equipmentType: 'Countable',
    paxPerUnit: '',
  });

  const [editFormData, setEditFormData] = useState({
    equipment_id: '',
    eqm_name: '',
    quantity_available: 0,
    damaged_quantity: 0,
    maintenance_quantity: 0,
    eqm_description: '',
    eqm_status: 'Good Condition',
    equipment_type: 'Countable',
    pax_per_unit: null,
  });

  const [assignFormData, setAssignFormData] = useState({
    booking_id: '',
    notes: '',
  });

  const [assignmentQueue, setAssignmentQueue] = useState([]);
  const [tempEquipId, setTempEquipId] = useState('');
  const [tempQuantity, setTempQuantity] = useState(1);

  // --- Error handler ---
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
          booking_number,
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

      // Fetch assignments with the new assignment_number
      const { data: assignData, error: assignError } = await supabase
        .from('booking_equipment')
        .select(`
          *,
          booking:booking_id (
            booking_id,
            booking_number,
            venue,
            event_datetime,
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

  // --- FETCH USAGE ---
  const fetchEquipmentUsage = async (equipmentId) => {
    try {
      const { data, error } = await supabase
        .from('booking_equipment')
        .select(`
          *,
          booking:booking_id (
            booking_id,
            booking_number,
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

  const selectedBooking = bookings.find(b => b.booking_id === assignFormData.booking_id);

  // --- HANDLERS ---
  const handleAddInputChange = (e) => {
    const { name, value } = e.target;
    setAddFormData(prev => ({
      ...prev,
      [name]: name === 'quantity' || name === 'damagedQuantity' || name === 'maintenanceQuantity'
        ? parseInt(value) || 0
        : name === 'paxPerUnit' ? (value === '' ? '' : parseInt(value) || 0) : value
    }));
  };

  const handleEditInputChange = (e) => {
    const { name, value } = e.target;
    setEditFormData(prev => ({
      ...prev,
      [name]: name === 'quantity_available' || name === 'damaged_quantity' || name === 'maintenance_quantity'
        ? parseInt(value) || 0
        : name === 'pax_per_unit' ? (value === '' ? null : parseInt(value) || 0) : value
    }));
  };

  const handleAssignInputChange = (e) => {
    const { name, value } = e.target;
    setAssignFormData(prev => ({ ...prev, [name]: value }));
  };

  // --- Equipment Card Click Handler ---
  const handleEquipmentCardClick = (filterFn, title) => {
    const filtered = equipmentList.filter(filterFn);
    setEquipmentModalData(filtered);
    setEquipmentModalTitle(title);
    setIsEquipmentModalOpen(true);
  };

  // --- ADD EQUIPMENT ---
  const handleAddEquipment = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    if (!addFormData.equipmentName.trim()) {
      toast.error('Equipment name is required.');
      setIsSubmitting(false);
      return;
    }
    const qty = parseInt(addFormData.quantity) || 0;
    if (qty < 1) {
      toast.error('Total quantity must be at least 1.');
      setIsSubmitting(false);
      return;
    }

    const damaged = parseInt(addFormData.damagedQuantity) || 0;
    const maintenance = parseInt(addFormData.maintenanceQuantity) || 0;
    
    if (damaged + maintenance > qty) {
      toast.error('Damaged + Maintenance quantities cannot exceed total quantity.');
      setIsSubmitting(false);
      return;
    }

    const available = qty - damaged - maintenance;

    try {
      const paxPerUnit = addFormData.equipmentType === 'Countable'
        ? (parseInt(addFormData.paxPerUnit) || null)
        : null;

      const { error } = await supabase
        .from('equipment')
        .insert([{
          eqm_name: addFormData.equipmentName.trim(),
          eqm_description: addFormData.description?.trim() || 'No description',
          quantity_available: available,
          damaged_quantity: damaged,
          maintenance_quantity: maintenance,
          eqm_status: addFormData.condition,
          equipment_type: addFormData.equipmentType,
          pax_per_unit: paxPerUnit,
        }]);

      if (error) throw error;

      setIsAddModalOpen(false);
      setAddFormData({ 
        equipmentName: '', 
        quantity: 0, 
        damagedQuantity: 0, 
        maintenanceQuantity: 0,
        description: '', 
        condition: 'Good Condition', 
        equipmentType: 'Countable', 
        paxPerUnit: '' 
      });
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
    const total = item.quantity_available + (item.damaged_quantity || 0) + (item.maintenance_quantity || 0);
    setEditFormData({
      equipment_id: item.equipment_id,
      eqm_name: item.eqm_name,
      quantity_available: total,
      damaged_quantity: item.damaged_quantity || 0,
      maintenance_quantity: item.maintenance_quantity || 0,
      eqm_description: item.eqm_description || '',
      eqm_status: item.eqm_status || 'Good Condition',
      equipment_type: item.equipment_type || 'Countable',
      pax_per_unit: item.pax_per_unit || null,
    });
    setIsEditModalOpen(true);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    if (!editFormData.eqm_name.trim()) {
      toast.error('Equipment name is required.');
      setIsSubmitting(false);
      return;
    }
    const qty = parseInt(editFormData.quantity_available) || 0;
    if (qty < 0) {
      toast.error('Total quantity cannot be negative.');
      setIsSubmitting(false);
      return;
    }

    const damaged = parseInt(editFormData.damaged_quantity) || 0;
    const maintenance = parseInt(editFormData.maintenance_quantity) || 0;
    
    if (damaged + maintenance > qty) {
      toast.error('Damaged + Maintenance quantities cannot exceed total quantity.');
      setIsSubmitting(false);
      return;
    }

    const available = qty - damaged - maintenance;

    try {
      const paxPerUnit = editFormData.equipment_type === 'Countable'
        ? (parseInt(editFormData.pax_per_unit) || null)
        : null;

      const { error } = await supabase
        .from('equipment')
        .update({
          eqm_name: editFormData.eqm_name.trim(),
          eqm_description: editFormData.eqm_description?.trim() || '',
          quantity_available: available,
          damaged_quantity: damaged,
          maintenance_quantity: maintenance,
          eqm_status: editFormData.eqm_status,
          equipment_type: editFormData.equipment_type,
          pax_per_unit: paxPerUnit,
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
      const { count, error: countError } = await supabase
        .from('booking_equipment')
        .select('*', { count: 'exact', head: true })
        .eq('equipment_id', id)
        .eq('returned', false);
      if (countError) throw countError;
      if (count > 0) {
        toast.error(`Cannot delete this equipment because it is currently assigned to ${count} active booking(s). Please return it first.`);
        return;
      }

      const { count: pkgCount, error: pkgCountError } = await supabase
        .from('package_equipment')
        .select('*', { count: 'exact', head: true })
        .eq('equipment_id', id);
      if (pkgCountError) throw pkgCountError;
      if (pkgCount > 0) {
        toast.error(`Cannot delete this equipment because it is used in ${pkgCount} package template(s). Remove it from packages first.`);
        return;
      }

      const { error } = await supabase
        .from('equipment')
        .delete()
        .eq('equipment_id', id);
      if (error) throw error;

      toast.success('Equipment deleted.');
      await fetchData();
    } catch (error) {
      handleError(error, 'Failed to delete equipment.');
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
      toast.error('This equipment is already in the list.');
      return;
    }
    const equip = equipmentList.find(e => e.equipment_id === tempEquipId);
    if (!equip) {
      toast.error('Equipment not found.');
      return;
    }

    if (tempQuantity > equip.quantity_available) {
      toast.warning(`You are assigning ${tempQuantity}, but only ${equip.quantity_available} available.`);
    }

    if (selectedBooking) {
      const alreadyAssigned = assignments.some(a =>
        a.booking_id === selectedBooking.booking_id &&
        a.equipment_id === tempEquipId &&
        !a.returned
      );
      if (alreadyAssigned) {
        toast.error(`"${equip.eqm_name}" is already assigned to this booking. Return it first.`);
        return;
      }
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

    const eventDate = selectedBooking?.event_datetime ? new Date(selectedBooking.event_datetime) : null;
if (eventDate) {
  for (const item of assignmentQueue) {
    const conflict = assignments.some(a =>
      a.equipment_id === item.equipment_id &&
      a.booking?.event_datetime &&
      new Date(a.booking.event_datetime).toDateString() === eventDate.toDateString() &&
      a.booking_id !== assignFormData.booking_id &&
      !a.returned
    );
    if (conflict) {
      const equip = equipmentList.find(e => e.equipment_id === item.equipment_id);
      toast.error(`"${equip?.eqm_name || 'Equipment'}" is already assigned to another event on ${eventDate.toLocaleDateString()}.`);
      return;
    }
  }
}
    setIsSubmitting(true);

    try {
      const itemsToAssign = [];
      for (const item of assignmentQueue) {
        const equip = equipmentList.find(e => e.equipment_id === item.equipment_id);
        if (!equip) throw new Error(`Equipment ID ${item.equipment_id} not found.`);
        const existing = assignments.find(a =>
          a.booking_id === assignFormData.booking_id &&
          a.equipment_id === item.equipment_id &&
          !a.returned
        );
        if (existing) {
          throw new Error(`"${equip.eqm_name}" is already assigned to this booking. Please return it first.`);
        }
        itemsToAssign.push({ ...item, equip });
      }

      for (const item of itemsToAssign) {
        const { error: insertError } = await supabase
          .from('booking_equipment')
          .insert([{
            booking_id: assignFormData.booking_id,
            equipment_id: item.equipment_id,
            quantity: item.quantity,
            notes: assignFormData.notes || null,
            returned: false,
          }]);
        if (insertError) throw insertError;
      }

      setAssignmentQueue([]);
      setIsAssignModalOpen(false);
      setAssignFormData({ booking_id: '', notes: '' });
      toast.success(`Successfully assigned ${itemsToAssign.length} equipment item(s).`);
      await fetchData();
    } catch (error) {
      handleError(error, error.message || 'Failed to assign equipment.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- RETURN EQUIPMENT ---
  const handleReturnEquipment = async (assignmentId) => {
    const confirmed = await showConfirm({
      title: 'Return Equipment?',
      message: 'Are you sure you want to mark this equipment as returned?',
      confirmLabel: 'Return',
      confirmVariant: 'success',
    });
    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from('booking_equipment')
        .update({ returned: true, returned_at: new Date().toISOString() })
        .eq('assignment_id', assignmentId);
      if (error) throw error;

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

  // --- STATS ---
  const totalItems = equipmentList.reduce((sum, eq) => sum + eq.quantity_available + (eq.damaged_quantity || 0) + (eq.maintenance_quantity || 0), 0);
  const damagedItems = equipmentList.reduce((sum, eq) => sum + (eq.damaged_quantity || 0), 0);
  const maintenanceItems = equipmentList.reduce((sum, eq) => sum + (eq.maintenance_quantity || 0), 0);
  const availableItems = equipmentList.reduce((sum, eq) => sum + eq.quantity_available, 0);
  const activeAssignments = assignments.filter(a => !a.returned).length;

  // --- Deployed Today ---
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deployedToday = assignments.filter(a => {
    if (a.returned) return false;
    if (!a.booking?.event_datetime) return false;
    const eventDate = new Date(a.booking.event_datetime);
    eventDate.setHours(0, 0, 0, 0);
    return eventDate.getTime() === today.getTime();
  }).length;

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

      {/* Stats Cards - Clickable */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <button
          onClick={() => handleEquipmentCardClick(() => true, 'All Equipment')}
          className="bg-[#CBDEDD]/60 border border-[#b4d2d0] rounded-xl p-5 text-center hover:shadow-md hover:border-[#008A45] transition-all cursor-pointer group"
        >
          <p className="text-xs font-semibold text-slate-600 mb-1">Total Items</p>
          <h3 className="text-3xl font-extrabold text-slate-900">{totalItems}</h3>
          <p className="text-[10px] text-slate-400 group-hover:text-[#008A45] transition-colors mt-1">Click to view all</p>
        </button>
        <button
          onClick={() => handleEquipmentCardClick(eq => eq.quantity_available > 0, 'Available Equipment')}
          className="bg-[#CBDEDD]/60 border border-[#b4d2d0] rounded-xl p-5 text-center hover:shadow-md hover:border-emerald-500 transition-all cursor-pointer group"
        >
          <p className="text-xs font-semibold text-slate-600 mb-1">Available</p>
          <h3 className="text-3xl font-extrabold text-emerald-700">{availableItems}</h3>
          <p className="text-[10px] text-slate-400 group-hover:text-emerald-600 transition-colors mt-1">Ready to use</p>
        </button>
        <button
          onClick={() => handleEquipmentCardClick(eq => (eq.damaged_quantity || 0) > 0, 'Damaged Equipment')}
          className="bg-[#CBDEDD]/60 border border-[#b4d2d0] rounded-xl p-5 text-center hover:shadow-md hover:border-red-500 transition-all cursor-pointer group"
        >
          <p className="text-xs font-semibold text-slate-600 mb-1">Damaged</p>
          <h3 className="text-3xl font-extrabold text-red-600">{damagedItems}</h3>
          <p className="text-[10px] text-slate-400 group-hover:text-red-600 transition-colors mt-1">Click to view</p>
        </button>
        <button
          onClick={() => handleEquipmentCardClick(eq => (eq.maintenance_quantity || 0) > 0, 'Under Maintenance Equipment')}
          className="bg-[#CBDEDD]/60 border border-[#b4d2d0] rounded-xl p-5 text-center hover:shadow-md hover:border-amber-500 transition-all cursor-pointer group"
        >
          <p className="text-xs font-semibold text-slate-600 mb-1">Maintenance</p>
          <h3 className="text-3xl font-extrabold text-amber-600">{maintenanceItems}</h3>
          <p className="text-[10px] text-slate-400 group-hover:text-amber-600 transition-colors mt-1">Click to view</p>
        </button>
        <button
          onClick={() => handleEquipmentCardClick(eq => eq.quantity_available > 0, 'Active Assignments')}
          className="bg-[#CBDEDD]/60 border border-[#b4d2d0] rounded-xl p-5 text-center hover:shadow-md hover:border-emerald-500 transition-all cursor-pointer group"
        >
          <p className="text-xs font-semibold text-slate-600 mb-1">Deployed Today</p>
          <h3 className="text-3xl font-extrabold text-[#008A45]">{deployedToday}</h3>
          <p className="text-[10px] text-slate-400 group-hover:text-[#008A45] transition-colors mt-1">Events today only</p>
        </button>
      </div>

      {/* Equipment Table - removed emoji icons */}
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
                <th className="p-4 font-bold text-center">Damaged</th>
                <th className="p-4 font-bold text-center">Maintenance</th>
                <th className="p-4 font-bold text-center">Type</th>
                <th className="p-4 font-bold text-center">Pax/Unit</th>
                <th className="p-4 font-bold text-center">Condition</th>
                <th className="p-4 font-bold text-center">Usage</th>
                <th className="p-4 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm text-slate-700">
              {isLoading ? (
                <tr><td colSpan="9" className="p-6 text-center text-slate-400">Loading equipment...</td></tr>
              ) : equipmentList.length === 0 ? (
                <tr><td colSpan="9" className="p-6 text-center text-slate-400 italic">No equipment found.</td></tr>
              ) : (
                equipmentList.map((item) => {
                  const usageCount = assignments.filter(a => a.equipment_id === item.equipment_id && !a.returned).length;
                  return (
                    <tr key={item.equipment_id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-4">
                        <p className="font-bold text-slate-900">{item.eqm_name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{item.eqm_description}</p>
                      </td>
                      <td className="p-4 text-center font-semibold text-emerald-700">{item.quantity_available}</td>
                      <td className="p-4 text-center font-semibold text-red-600">{item.damaged_quantity || 0}</td>
                      <td className="p-4 text-center font-semibold text-amber-600">{item.maintenance_quantity || 0}</td>
                      <td className="p-4 text-center">
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold 
                          ${item.equipment_type === 'Decoration' ? 'bg-purple-50 border-purple-200 text-purple-700' : 'bg-blue-50 border-blue-200 text-blue-700'}`}
                        >
                          {item.equipment_type === 'Decoration' ? 'Decoration' : 'Countable'}
                        </span>
                      </td>
                      <td className="p-4 text-center font-semibold text-slate-900">
                        {item.pax_per_unit ? `${item.pax_per_unit} pax` : '—'}
                      </td>
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

      {/* Active Assignments Table - now using assignment_number */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-200 font-bold text-sm text-slate-800 flex justify-between items-center">
          <span>Active Equipment Assignments</span>
          <span className="text-xs font-normal text-slate-500">{activeAssignments} active</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#EAF3F2] text-slate-800 text-sm border-b border-slate-200">
                <th className="p-4 font-bold">Assignment #</th>
                <th className="p-4 font-bold">Client</th>
                <th className="p-4 font-bold">Booking Ref</th>
                <th className="p-4 font-bold">Equipment</th>
                <th className="p-4 font-bold text-center">Qty</th>
                <th className="p-4 font-bold">Event Date</th>
                <th className="p-4 font-bold text-center">Status</th>
                <th className="p-4 font-bold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm text-slate-700">
              {isLoading ? (
                <tr><td colSpan="8" className="p-6 text-center text-slate-400">Loading assignments...</td></tr>
              ) : assignments.filter(a => !a.returned).length === 0 ? (
                <tr><td colSpan="8" className="p-6 text-center text-slate-400 italic">No active assignments.</td></tr>
              ) : (
                assignments.filter(a => !a.returned).map((assign) => {
                  const eventDate = assign.booking?.event_datetime ? new Date(assign.booking.event_datetime) : null;
                  const isToday = eventDate && eventDate.toDateString() === new Date().toDateString();
                  const isPast = eventDate && eventDate < new Date();
                  const isFuture = eventDate && eventDate > new Date();
                  
                  let statusText = 'Assigned';
                  let statusColor = 'bg-amber-50 border-amber-200 text-amber-700';
                  if (isToday) {
                    statusText = '📌 Deployed Today';
                    statusColor = 'bg-green-50 border-green-200 text-green-700';
                  } else if (isPast) {
                    statusText = '⚠️ Past Event';
                    statusColor = 'bg-red-50 border-red-200 text-red-700';
                  } else if (isFuture) {
                    statusText = '📅 Upcoming';
                    statusColor = 'bg-blue-50 border-blue-200 text-blue-700';
                  }

                  // Use assignment_number if available, else fallback to a short ID
                  const assignmentDisplay = assign.assignment_number || `EQP-${assign.assignment_id.slice(0, 6)}`;
                  
                  // Booking reference: use booking_number if available, else fallback
                  const bookingRef = assign.booking?.booking_number || (assign.booking?.booking_id ? `BKG-${assign.booking.booking_id.slice(0, 8)}` : 'N/A');

                  return (
                    <tr key={assign.assignment_id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-4 font-mono text-xs font-bold text-slate-800">{assignmentDisplay}</td>
                      <td className="p-4 font-bold text-slate-900">
                        {assign.booking?.customer ? `${assign.booking.customer.first_name} ${assign.booking.customer.last_name}` : 'Unknown'}
                      </td>
                      <td className="p-4 font-mono text-xs text-slate-600">{bookingRef}</td>
                      <td className="p-4 font-medium text-slate-800">{assign.equipment?.eqm_name || 'Unknown'}</td>
                      <td className="p-4 text-center font-bold text-[#008A45]">{assign.quantity}</td>
                      <td className="p-4 text-slate-600 text-xs">
                        {eventDate ? eventDate.toLocaleDateString() : 'N/A'}
                        {isToday && <span className="ml-1 text-xs font-bold text-green-600">(Today)</span>}
                      </td>
                      <td className="p-4 text-center">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor}`}>
                          {statusText}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <button
                          onClick={() => handleReturnEquipment(assign.assignment_id)}
                          className="text-blue-500 hover:text-blue-700 transition-colors cursor-pointer flex items-center gap-1 text-sm font-medium"
                        >
                          <Undo2 size={16} /> Return
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ========================================================= */}
      {/* MODALS – unchanged except removing icons inside where needed */}
      {/* ========================================================= */}
      {/* ADD EQUIPMENT MODAL */}
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
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Equipment Name *</label>
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
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Total Quantity *</label>
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

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Damaged Quantity</label>
                  <input
                    type="number"
                    name="damagedQuantity"
                    min="0"
                    value={addFormData.damagedQuantity}
                    onChange={handleAddInputChange}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-semibold text-red-600 focus:ring-2 focus:ring-red-200 focus:border-red-400 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Maintenance Quantity</label>
                  <input
                    type="number"
                    name="maintenanceQuantity"
                    min="0"
                    value={addFormData.maintenanceQuantity}
                    onChange={handleAddInputChange}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-semibold text-amber-600 focus:ring-2 focus:ring-amber-200 focus:border-amber-400 outline-none"
                  />
                </div>
              </div>
              <p className="text-xs text-slate-400 -mt-2">Damaged + Maintenance cannot exceed Total Quantity</p>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Equipment Type</label>
                <select
                  name="equipmentType"
                  value={addFormData.equipmentType}
                  onChange={handleAddInputChange}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                >
                  <option value="Countable">Countable (chairs, plates, etc.)</option>
                  <option value="Decoration">Decoration / Per Event</option>
                </select>
                <p className="text-xs text-slate-400 mt-1">
                  <span className="font-semibold">Countable:</span> quantity is tracked per unit.
                  <br />
                  <span className="font-semibold">Decoration:</span> usually assigned as 1 per event.
                </p>
              </div>
              {addFormData.equipmentType === 'Countable' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Pax per Unit
                    <span className="font-normal text-slate-400 ml-1">(how many guests can each unit serve?)</span>
                  </label>
                  <input
                    type="number"
                    name="paxPerUnit"
                    min="1"
                    value={addFormData.paxPerUnit}
                    onChange={handleAddInputChange}
                    placeholder="e.g., 1 for chair, 10 for table"
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                  />
                  <p className="text-xs text-slate-400 mt-1">Used to auto‑calculate needed quantity based on guest count.</p>
                </div>
              )}
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

      {/* EDIT EQUIPMENT MODAL - similar to add, but we keep it unchanged except for fields */}
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
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Equipment Name *</label>
                  <input type="text" name="eqm_name" value={editFormData.eqm_name} onChange={handleEditInputChange} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none font-medium text-slate-800" required />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Total Quantity *</label>
                  <input type="number" name="quantity_available" min="0" value={editFormData.quantity_available} onChange={handleEditInputChange} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none" required />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Damaged Quantity</label>
                  <input type="number" name="damaged_quantity" min="0" value={editFormData.damaged_quantity} onChange={handleEditInputChange} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-semibold text-red-600 focus:ring-2 focus:ring-red-200 focus:border-red-400 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Maintenance Quantity</label>
                  <input type="number" name="maintenance_quantity" min="0" value={editFormData.maintenance_quantity} onChange={handleEditInputChange} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-semibold text-amber-600 focus:ring-2 focus:ring-amber-200 focus:border-amber-400 outline-none" />
                </div>
              </div>
              <p className="text-xs text-slate-400 -mt-2">Damaged + Maintenance cannot exceed Total Quantity</p>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Equipment Type</label>
                <select name="equipment_type" value={editFormData.equipment_type} onChange={handleEditInputChange} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none">
                  <option value="Countable">Countable (chairs, plates, etc.)</option>
                  <option value="Decoration">Decoration / Per Event</option>
                </select>
              </div>
              {editFormData.equipment_type === 'Countable' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Pax per Unit</label>
                  <input type="number" name="pax_per_unit" min="1" value={editFormData.pax_per_unit || ''} onChange={handleEditInputChange} placeholder="e.g., 1 for chair, 10 for table" className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none" />
                </div>
              )}
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

      {/* ASSIGN EQUIPMENT MODAL - unchanged (assignment_number will be auto-generated) */}
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
                        {b.booking_number || b.booking_id.slice(0, 8)} - {customerName} ({date})
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
                    onChange={(e) => {
                      setTempEquipId(e.target.value);
                      const equipId = e.target.value;
                      const equip = equipmentList.find(eq => eq.equipment_id === equipId);
                      if (selectedBooking && equip?.pax_per_unit && equip.equipment_type === 'Countable') {
                        const pax = selectedBooking.pax_count || 0;
                        const needed = Math.ceil(pax / equip.pax_per_unit);
                        if (needed > 0) {
                          setTempQuantity(needed);
                          toast.info(`Suggested quantity: ${needed} based on ${pax} pax.`);
                        }
                      } else {
                        setTempQuantity(1);
                      }
                    }}
                    className="flex-1 border border-slate-300 rounded-lg p-2 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                  >
                    <option value="">Select equipment...</option>
                    {equipmentList.map((eq) => (
                      <option key={eq.equipment_id} value={eq.equipment_id}>
                        {eq.eqm_name} ({eq.quantity_available} available) {eq.equipment_type === 'Decoration' ? '[Decoration]' : ''}
                        {eq.pax_per_unit ? ` - ${eq.pax_per_unit} pax/unit` : ''}
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
                      const isDecoration = equip?.equipment_type === 'Decoration';
                      return (
                        <div key={item.equipment_id} className="flex items-center justify-between bg-white border border-slate-200 rounded px-3 py-1.5 text-sm">
                          <span className="font-medium text-slate-700">
                            {equip?.eqm_name || 'Unknown'} × {item.quantity}
                            {isDecoration && <span className="ml-2 text-xs text-purple-600">(Decoration)</span>}
                            {equip?.pax_per_unit && !isDecoration && (
                              <span className="ml-2 text-xs text-slate-500">(each serves {equip.pax_per_unit} pax)</span>
                            )}
                          </span>
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

      {/* USAGE MODAL (unchanged) */}
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
                          <p className="text-xs text-slate-500">Booking: {booking?.booking_number || booking?.booking_id?.slice(0, 8) || 'N/A'} · Quantity: <span className="font-bold text-[#008A45]">{record.quantity}</span></p>
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

      {/* EQUIPMENT DETAIL MODAL (Clickable Cards) */}
      {isEquipmentModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4 animate-in fade-in zoom-in-95 duration-150">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0 bg-white">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{equipmentModalTitle}</h2>
                <p className="text-xs text-slate-500 mt-0.5">{equipmentModalData.length} item(s) found</p>
              </div>
              <button
                onClick={() => setIsEquipmentModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              {equipmentModalData.length === 0 ? (
                <div className="text-center py-10 text-slate-500">No equipment found for this category.</div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-700 text-xs font-bold border-b border-slate-200">
                      <th className="p-3">Equipment</th>
                      <th className="p-3 text-center">Available</th>
                      <th className="p-3 text-center">Damaged</th>
                      <th className="p-3 text-center">Maint.</th>
                      <th className="p-3 text-center">Type</th>
                      <th className="p-3 text-center">Pax/Unit</th>
                      <th className="p-3 text-center">Condition</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {equipmentModalData.map((item) => (
                      <tr key={item.equipment_id} className="hover:bg-slate-50 transition-colors">
                        <td className="p-3">
                          <p className="font-bold text-slate-900">{item.eqm_name}</p>
                          <p className="text-xs text-slate-500">{item.eqm_description}</p>
                        </td>
                        <td className="p-3 text-center font-semibold text-emerald-700">{item.quantity_available}</td>
                        <td className="p-3 text-center font-semibold text-red-600">{item.damaged_quantity || 0}</td>
                        <td className="p-3 text-center font-semibold text-amber-600">{item.maintenance_quantity || 0}</td>
                        <td className="p-3 text-center">
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-bold 
                            ${item.equipment_type === 'Decoration' ? 'bg-purple-50 border-purple-200 text-purple-700' : 'bg-blue-50 border-blue-200 text-blue-700'}`}
                          >
                            {item.equipment_type === 'Decoration' ? 'Decoration' : 'Countable'}
                          </span>
                        </td>
                        <td className="p-3 text-center font-semibold text-slate-900">
                          {item.pax_per_unit ? `${item.pax_per_unit} pax` : '—'}
                        </td>
                        <td className="p-3 text-center">
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-bold 
                            ${item.eqm_status === 'Good Condition' ? 'bg-[#CBDEDD]/60 border-[#a3c7c4] text-slate-800' : 
                              item.eqm_status === 'Damaged' ? 'bg-red-50 border-red-200 text-red-600' :
                              'bg-yellow-50 border-yellow-200 text-yellow-700'}`}
                          >
                            <CheckCircle size={12} className={item.eqm_status === 'Good Condition' ? 'text-[#008A45]' : 'text-slate-400'} />
                            {item.eqm_status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                    <tr>
                      <td colSpan="7" className="p-3 text-right font-bold text-slate-700">
                        Total: {equipmentModalData.length} item(s)
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 bg-slate-50 border-t border-slate-200 shrink-0">
              <button
                onClick={() => setIsEquipmentModalOpen(false)}
                className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}